import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';

export type NbaLoginResult = 'ok' | 'invalid' | 'blocked' | 'verification' | 'unavailable' | 'unknown';
export type LoginObservation = { text: string; passwordVisible: boolean; authenticated: boolean; challengeVisible: boolean; url?: string; accountHeadingVisible?: boolean };
export function classifyNbaLogin(o: LoginObservation, expectedEmail?: string): NbaLoginResult {
  if (/incorrect (email|password)|invalid (email|password|credentials)|email (or|and) password.*(incorrect|invalid)|account (is |has been )?(locked|disabled)|wrong password|비밀번호.*(틀|일치하지)|계정.*잠[겨금]/i.test(o.text)) return 'invalid';
  if (/access denied/i.test(o.text)) return 'blocked';
  if (o.challengeVisible || /verify (your identity|it's you)|verification code|security code|enter.*code|보안 인증|인증 ?코드|recaptcha.*(connect|연결)|unusual activity|too many (requests|attempts)|temporarily blocked/i.test(o.text)) return 'verification';
  if (/service unavailable|temporarily unavailable|something went wrong|try again later|일시.*오류/i.test(o.text)) return 'unavailable';
  if (o.authenticated && !o.passwordVisible) return 'ok';
  if (expectedEmail && !o.passwordVisible && o.accountHeadingVisible && o.url) {
    try {
      const url = new URL(o.url);
      const emails = o.text.match(/[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}/gi) || [];
      if (url.origin === 'https://www.nba.com' && url.pathname === '/account/nbaprofile'
        && emails.some(email => email.toLowerCase() === expectedEmail.toLowerCase())) return 'ok';
    } catch { /* An invalid or unrelated URL cannot prove authentication. */ }
  }
  return 'unknown';
}
export function nbaHttpResult(status: number): NbaLoginResult | undefined {
  if (status === 403) return 'blocked';
  if ([401, 429].includes(status)) return 'verification';
  if (status >= 500 || !status) return 'unavailable';
  if (status >= 400) return 'unknown';
  return undefined;
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
export async function observeNbaPage(page: Pick<Page, 'evaluate'>): Promise<LoginObservation> {
  return page.evaluate(() => {
    // Keep this callback self-contained: tsx injects an external __name helper for named local arrows.
    return {
      text: document.body.innerText.slice(0, 16000),
      url: location.href,
      accountHeadingVisible: [...document.querySelectorAll('h1,h2,h3')].some(el => el.checkVisibility({ visibilityProperty: true }) && /^my account$/i.test(el.textContent?.trim() || '')),
      passwordVisible: [...document.querySelectorAll('input[type="password"]')].some(el => el.checkVisibility({ visibilityProperty: true })),
      authenticated: [...document.querySelectorAll('a,button')].some(el => el.checkVisibility({ visibilityProperty: true }) && /^(sign out|log out)$/i.test(el.textContent?.trim() || '')),
      challengeVisible: [...document.querySelectorAll('iframe')].some(el => el.checkVisibility({ visibilityProperty: true })
        && (/bframe|challenge/i.test(el.src) || /challenge/i.test(el.title)
          || (/\/recaptcha\/(api2|enterprise)\/anchor/i.test(el.src) && !/[?&]size=invisible(?:&|$)/i.test(el.src)))),
    };
  });
}
async function waitResult(page: Page, timeout: number, expectedEmail: string): Promise<NbaLoginResult> {
  const end = Date.now() + timeout;
  do {
    const result = classifyNbaLogin(await observeNbaPage(page), expectedEmail);
    if (result !== 'unknown') return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < end);
  return 'unknown';
}
async function dismissOptionalCookies(page: Page): Promise<void> {
  const rejectCookies = await page.$('#onetrust-reject-all-handler');
  if (rejectCookies && await rejectCookies.isVisible()) await rejectCookies.click();
}
/** Runs in the page: choose the password panel's button, never the header's identical label. */
export function findNbaPasswordSubmit(): HTMLButtonElement | null {
  let scope = document.querySelector('input[type="password"]')?.parentElement;
  while (scope && scope !== document.body) {
    const buttons = [...scope.querySelectorAll('button')].filter(button => !button.closest('header,nav,[role="navigation"]')
      && /^sign in$/i.test(button.textContent?.trim() || ''));
    if (buttons.length) return buttons.length === 1 ? buttons[0] : null;
    scope = scope.parentElement;
  }
  return null;
}
/** Fresh isolated context: proves a password login, never accepts a cached session as healthy. */
export async function checkNbaLogin(email: string, password: string): Promise<NbaLoginResult> {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: nbaBrowserPath(), headless: false,
      args: ['--disable-dev-shm-usage'], timeout: 30000 });
    const context = await browser.createBrowserContext(); const page = await context.newPage();
    page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(40000);
    const response = await page.goto('https://www.nba.com/account/sign-in', { waitUntil: 'networkidle2', timeout: 40000 });
    const statusResult = nbaHttpResult(response?.status() || 0);
    if (statusResult) return statusResult;
    const initialResult = classifyNbaLogin(await observeNbaPage(page));
    if (initialResult !== 'unknown' && initialResult !== 'ok') return initialResult;
    // Dismiss optional tracking consent without accepting it or changing account settings.
    await dismissOptionalCookies(page);
    const emailInput = await page.waitForSelector('input[type="email"]', { visible: true });
    if (!emailInput) return 'unknown';
    await emailInput.type(email); await page.click('#email-submit');
    try { await page.waitForSelector('input[type="password"]', { visible: true, timeout: 25000 }); }
    catch { return await waitResult(page, 1000, email); }
    // This is a separate hydrated step; the field can appear before its submit handler is ready.
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => undefined);
    await dismissOptionalCookies(page);
    await page.type('input[type="password"]', password);
    await page.locator(findNbaPasswordSubmit).click();
    return await waitResult(page, 35000, email);
  } catch { return 'unavailable'; }
  finally { if (browser) await browser.close().catch(() => undefined); }
}
