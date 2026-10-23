import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';

export type NbaLoginResult = 'ok' | 'invalid' | 'verification' | 'unavailable' | 'unknown';
export type LoginObservation = { text: string; passwordVisible: boolean; authenticated: boolean; challengeVisible: boolean };
export function classifyNbaLogin(o: LoginObservation): NbaLoginResult {
  if (/incorrect (email|password)|invalid (email|password|credentials)|email (or|and) password.*(incorrect|invalid)|account (is |has been )?(locked|disabled)|wrong password|비밀번호.*(틀|일치하지)|계정.*잠[겨금]/i.test(o.text)) return 'invalid';
  if (o.challengeVisible || /verify (your identity|it's you)|verification code|security code|enter.*code|보안 인증|인증 ?코드|recaptcha.*(connect|연결)|access denied|unusual activity|too many (requests|attempts)|temporarily blocked/i.test(o.text)) return 'verification';
  if (/service unavailable|temporarily unavailable|something went wrong|try again later|일시.*오류/i.test(o.text)) return 'unavailable';
  if (o.authenticated && !o.passwordVisible) return 'ok';
  return 'unknown';
}
export function nbaBrowserPath(): string {
  if (process.env.NBA_CHROME_PATH) return process.env.NBA_CHROME_PATH;
  for (const path of ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable']) if (existsSync(path)) return path;
  const cache = join(homedir(), '.cache/puppeteer/chrome');
  if (existsSync(cache)) for (const v of readdirSync(cache).sort().reverse()) {
    const candidate = join(cache, v, 'chrome-linux64/chrome'); if (existsSync(candidate)) return candidate;
  }
  for (const path of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(path)) return path;
  throw new Error('NBA_BROWSER_UNAVAILABLE');
}
export async function observeNbaPage(page: Page): Promise<LoginObservation> {
  return page.evaluate(() => {
    const visible = (el: Element) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    return {
      text: document.body.innerText.slice(0, 16000),
      passwordVisible: [...document.querySelectorAll('input[type="password"]')].some(visible),
      authenticated: [...document.querySelectorAll('a,button')].some(el => visible(el) && /^(sign out|log out)$/i.test(el.textContent?.trim() || '')),
      challengeVisible: [...document.querySelectorAll('iframe')].some(el => visible(el) && (/bframe|challenge/i.test(el.src) || /challenge/i.test(el.title))),
    };
  });
}
async function waitResult(page: Page, timeout: number): Promise<NbaLoginResult> {
  const end = Date.now() + timeout;
  do {
    const result = classifyNbaLogin(await observeNbaPage(page));
    if (result !== 'unknown') return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < end);
  return 'unknown';
}
/** Fresh isolated context: proves a password login, never accepts a cached session as healthy. */
export async function checkNbaLogin(email: string, password: string): Promise<NbaLoginResult> {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: nbaBrowserPath(), headless: true,
      args: ['--disable-dev-shm-usage'], timeout: 30000 });
    const context = await browser.createBrowserContext(); const page = await context.newPage();
    page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(40000);
    await page.goto('https://www.nba.com/account/sign-in', { waitUntil: 'domcontentloaded' });
    const emailInput = await page.waitForSelector('input[type="email"]', { visible: true });
    if (!emailInput) return 'unknown';
    await emailInput.type(email); await page.click('#email-submit');
    try { await page.waitForSelector('input[type="password"]', { visible: true, timeout: 25000 }); }
    catch { return await waitResult(page, 1000); }
    await page.type('input[type="password"]', password);
    const clicked = await page.evaluate(() => {
      const password = document.querySelector('input[type="password"]'); const form = password?.closest('form');
      const scope = form || document;
      const button = [...scope.querySelectorAll('button')].find(el => /^sign in$/i.test(el.textContent?.trim() || '') && !el.disabled);
      if (!button) return false; button.click(); return true;
    });
    if (!clicked) return 'unknown';
    return await waitResult(page, 35000);
  } catch { return 'unavailable'; }
  finally { if (browser) await browser.close().catch(() => undefined); }
}
