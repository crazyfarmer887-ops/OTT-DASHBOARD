import { type Page } from 'puppeteer-core';
import { withNbaBrowser } from './nba-browser';
import { createNbaCaptchaHandler, type NbaCaptchaHandler } from './nba-captcha';
export { nbaBrowserPath } from './nba-browser';

export type NbaLoginResult = 'ok' | 'invalid' | 'blocked' | 'verification' | 'unavailable' | 'unknown';
export type LoginObservation = { text: string; passwordVisible: boolean; authenticated: boolean; challengeVisible: boolean; credentialErrorVisible?: boolean; url?: string; accountHeadingVisible?: boolean };
export function classifyNbaLogin(o: LoginObservation, expectedEmail?: string): NbaLoginResult {
  if (/access denied/i.test(o.text)) return 'blocked';
  if (o.challengeVisible || /verify (your identity|it's you)|verification code|security code|enter.*code|보안 인증|인증 ?코드|recaptcha.*(connect|연결)|unusual activity|too many (requests|attempts)|temporarily blocked/i.test(o.text)) return 'verification';
  if (/service unavailable|temporarily unavailable|something went wrong|try again later|일시.*오류/i.test(o.text)) return 'unavailable';
  if (o.credentialErrorVisible !== false && o.text.split('\n').some(line => /^(?:(?:incorrect|invalid) (?:email(?: or password)?|password|credentials)|(?:email (?:or|and) password|password) (?:is |are )?(?:incorrect|invalid)|wrong password|(?:your )?account (?:is |has been )?(?:locked|disabled))(?:[.!]|$)/i.test(line.trim()))) return 'invalid';
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
export async function observeNbaPage(page: Pick<Page, 'evaluate'>): Promise<LoginObservation> {
  return page.evaluate(() => {
    // Keep this callback self-contained: tsx injects an external __name helper for named local arrows.
    return {
      text: document.body.innerText.slice(0, 16000),
      // Only exact visible error messages count, rather than hidden template/help copy.
      credentialErrorVisible: [...document.querySelectorAll('p,div,span,[role="alert"]')].some(el => el.checkVisibility({ visibilityProperty: true })
        && !el.querySelector('p,div,span') && /^(?:(?:incorrect|invalid) (?:email(?: or password)?|password|credentials)|(?:email (?:or|and) password|password) (?:is |are )?(?:incorrect|invalid)|wrong password|(?:your )?account (?:is |has been )?(?:locked|disabled))(?:[.!]|$)/i.test(el.textContent?.trim() || '')),
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
async function waitResult(page: Page, timeout: number, expectedEmail: string, captcha: NbaCaptchaHandler, password: string): Promise<NbaLoginResult> {
  let end = Date.now() + timeout; let last: NbaLoginResult = 'unknown';
  do {
    const observation = await observeNbaPage(page);
    const result = classifyNbaLogin(observation, expectedEmail); last = result;
    if (result === 'verification' && observation.challengeVisible && captcha.enabled) {
      if (!captcha.attempted) {
        if (!await captcha.solve(page)) return 'verification';
        await new Promise(resolve => setTimeout(resolve, 1000));
        if ((await observeNbaPage(page)).passwordVisible) {
          if (!await fillNbaInput(page, 'input[type="password"]', password)) return 'unavailable';
          await page.locator(findNbaPasswordSubmit).click();
        }
        end = Date.now() + timeout;
        continue;
      }
      if (!captcha.solved) return 'verification';
      // A solved checkbox can remain visible briefly while NBA processes the sign-in.
    } else if (result !== 'unknown') return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < end);
  return last;
}
async function emailProgressResult(page: Page, email: string, captcha: NbaCaptchaHandler, password: string): Promise<NbaLoginResult> {
  const result = await waitResult(page, 1000, email, captcha, password);
  return result === 'invalid' ? 'unknown' : result; // Email progression alone cannot prove a rejected password.
}
async function dismissOptionalCookies(page: Page): Promise<void> {
  const rejectCookies = await page.$('#onetrust-reject-all-handler');
  if (rejectCookies && await rejectCookies.isVisible()) await rejectCookies.click();
}
/** Runs in the page: choose the password panel's button, never the header's identical label. */
export function findNbaPasswordSubmit(): HTMLButtonElement | null {
  const fields = [...document.querySelectorAll('input[type="password"]')].filter(el => el.checkVisibility({ visibilityProperty: true }));
  if (fields.length !== 1) return null;
  let scope = fields[0].parentElement;
  while (scope && scope !== document.body) {
    const buttons = [...scope.querySelectorAll('button')].filter(button => !button.closest('header,nav,[role="navigation"]')
      && /^sign in$/i.test(button.textContent?.trim() || ''));
    if (buttons.length) return buttons.length === 1 ? buttons[0] : null;
    scope = scope.parentElement;
  }
  return null;
}
/** Fresh isolated context: proves a password login, never accepts a cached session as healthy. */
async function attemptNbaLogin(email: string, password: string): Promise<NbaLoginResult> {
  try {
    return await withNbaBrowser(async browser => {
      const captcha = createNbaCaptchaHandler();
      const context = await browser.createBrowserContext(); const page = await context.newPage();
      page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(40000);
      const response = await page.goto('https://www.nba.com/account/sign-in', { waitUntil: 'networkidle2', timeout: 40000 });
      const statusResult = nbaHttpResult(response?.status() || 0);
      if (statusResult) return statusResult;
      const initial = await observeNbaPage(page); const initialResult = classifyNbaLogin(initial);
      if (initialResult === 'invalid') return 'unknown'; // No password has been submitted yet.
      if (initialResult !== 'unknown' && initialResult !== 'ok') {
        if (initialResult !== 'verification' || !initial.challengeVisible || !await captcha.solve(page)) return initialResult;
      }
      // Dismiss optional tracking consent without accepting it or changing account settings.
      await dismissOptionalCookies(page);
      const emailInput = await page.waitForSelector('input[type="email"]', { visible: true });
      if (!emailInput) return 'unknown';
      if (!await fillNbaInput(page, 'input[type="email"]', email)) return 'unavailable';
      await page.click('#email-submit');
      try { await page.waitForSelector('input[type="password"]', { visible: true, timeout: 25000 }); }
      catch {
        const observation = await observeNbaPage(page);
        if (!observation.challengeVisible || !await captcha.solve(page)) return await emailProgressResult(page, email, captcha, password);
        const emailSubmit = await page.$('#email-submit');
        if (emailSubmit && await emailSubmit.isVisible()) await emailSubmit.click();
        try { await page.waitForSelector('input[type="password"]', { visible: true, timeout: 25000 }); }
        catch { return await emailProgressResult(page, email, captcha, password); }
      }
      // This is a separate hydrated step; the field can appear before its submit handler is ready.
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => undefined);
      await dismissOptionalCookies(page);
      if (!await fillNbaInput(page, 'input[type="password"]', password)) return 'unavailable';
      await page.locator(findNbaPasswordSubmit).click();
      return await waitResult(page, 35000, email, captcha, password);
    });
  } catch { return 'unavailable'; }
}

/** Replace contents using ordinary input events; hydration must not silently drop credentials. */
export async function fillNbaInput(page: Pick<Page, 'waitForSelector'>, selector: string, value: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = await page.waitForSelector(selector, { visible: true });
    if (!input) continue;
    await input.click({ clickCount: 3 });
    await input.press('Backspace');
    await input.type(value, { delay: 20 });
    if (await input.evaluate((el, expected) => (el as HTMLInputElement).value === expected, value)) return true;
  }
  return false;
}
/** A single rejection can be transient. Only a second isolated rejection confirms invalid. */
export async function confirmNbaRejection(attempt: () => Promise<NbaLoginResult>, pause: () => Promise<void>): Promise<NbaLoginResult> {
  const first = await attempt();
  if (first !== 'invalid') return first;
  await pause();
  return attempt();
}
export async function checkNbaLogin(email: string, password: string): Promise<NbaLoginResult> {
  return confirmNbaRejection(() => attemptNbaLogin(email, password), () => new Promise(resolve => setTimeout(resolve, 3000)));
}
