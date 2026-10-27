import { randomUUID } from 'node:crypto';
import puppeteer, { type Browser, type CookieData, type ConnectionTransport, type Page } from 'puppeteer-core';
import WebSocket from 'ws';
import { FAMILY_MANAGER, canonicalGoogleEmail, type FamilyDriver, type FamilyView } from './gbuts-google-invites';

const familyURL = 'https://myaccount.google.com/family/details?hl=en';
const cookieDomains = new Set(['.google.com', 'google.com', 'myaccount.google.com', 'accounts.google.com', '.youtube.com', 'youtube.com', 'www.youtube.com']);
export function googleCookieImport(raw: unknown): CookieData[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) throw Error('COOKIE_IMPORT_INVALID');
  return raw.map(c => {
    if (!cookieDomains.has(c.domain) || typeof c.name !== 'string' || !c.name || typeof c.value !== 'string'
      || typeof c.path !== 'string' || !c.path.startsWith('/') || /[\r\n\0]/.test(c.value)) throw Error('COOKIE_IMPORT_INVALID');
    const expires = c.expires ?? c.expirationDate;
    const sameSite = ({ strict: 'Strict', lax: 'Lax', no_restriction: 'None', Strict: 'Strict', Lax: 'Lax', None: 'None' } as Record<string, 'Strict' | 'Lax' | 'None'>)[c.sameSite];
    return { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: Boolean(c.secure), httpOnly: Boolean(c.httpOnly),
      ...(Number.isFinite(expires) && expires > 0 && c.session !== true ? { expires } : {}), ...(sameSite ? { sameSite } : {}) };
  });
}
/** This owns a separate Steel session; it never touches NBA sessions or local Chrome. */
export async function withSteelFamilyBrowser<T>(cookies: CookieData[], work: (browser: Browser) => Promise<T>, saveCookies: (cookies: CookieData[]) => void): Promise<T> {
  const key = process.env.STEEL_API_KEY?.trim();
  if (!key || /\s/.test(key)) throw Error('STEEL_KEY_REQUIRED');
  const id = randomUUID(); let browser: Browser | undefined, socket: WebSocket | undefined;
  const request = async (suffix: string, body?: object) => {
    const r = await fetch(`https://api.steel.dev/v1/sessions${suffix}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'steel-api-key': key, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw Error('STEEL_REQUEST_FAILED');
    return r;
  };
  try {
    const session = await (await request('', { sessionId: id, timeout: 360000, inactivityTimeout: 60000, headless: false,
      useProxy: false, solveCaptcha: false, persistProfile: false,
      stealthConfig: { skipFingerprintInjection: true, humanizeInteractions: false }, debugConfig: { interactive: false } })).json() as { id?: string };
    if (session.id !== id) throw Error('STEEL_SESSION_INVALID');
    const url = new URL('wss://connect.steel.dev'); url.searchParams.set('apiKey', key); url.searchParams.set('sessionId', id);
    socket = new WebSocket(url, { handshakeTimeout: 30000, followRedirects: false, perMessageDeflate: false });
    const transport: ConnectionTransport = { send: m => socket!.send(m), close: () => socket!.terminate() };
    socket.on('message', x => transport.onmessage?.(x.toString())); socket.on('close', () => transport.onclose?.());
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.on('error', () => reject(Error('STEEL_CONNECTION_FAILED'))); socket!.once('close', () => reject(Error('STEEL_CONNECTION_CLOSED'))); });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { browser = await Promise.race([puppeteer.connect({ transport, protocolTimeout: 30000 }), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { socket!.terminate(); reject(Error('STEEL_CONNECTION_TIMEOUT')); }, 30000);
    })]); } finally { clearTimeout(timeout); }
    await browser.defaultBrowserContext().setCookie(...cookies);
    const result = await work(browser);
    saveCookies((await browser.defaultBrowserContext().cookies()).filter(x => cookieDomains.has(x.domain)));
    return result;
  } finally {
    browser?.disconnect(); socket?.terminate();
    await request(`/${id}/release`);
  }
}
export function membershipBenefitsDate(text: string, now = new Date()): string | undefined {
  if (!/Langganan keluarga:|Family membership:/.test(text)) return;
  const months: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, Mei: 5, May: 5, Jun: 6, Jul: 7, Agu: 8, Aug: 8, Sep: 9, Okt: 10, Oct: 10, Nov: 11, Des: 12, Dec: 12 };
  const dates: string[] = [];
  for (const line of text.split('\n').filter(x => /Waktu (?:akhir|berakhir) manfaat:|Benefits end(?:s)?(?: on)?:/i.test(x))) {
    const m = line.match(/(?:([0-9]{1,2})\s+([A-Za-z]{3,})|([A-Za-z]{3,})\s+([0-9]{1,2}))(?:,?\s+(20\d{2}))?/);
    if (!m) throw Error('MEMBERSHIP_DATE_INVALID');
    const month = months[(m[2] || m[3]).slice(0, 3)], day = Number(m[1] || m[4]), year = Number(m[5] || now.getUTCFullYear());
    if (!month || !day) throw Error('MEMBERSHIP_DATE_INVALID');
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (new Date(date).toISOString().slice(0, 10) !== date) throw Error('MEMBERSHIP_DATE_INVALID');
    dates.push(date);
  }
  // If summary/detail show different dates, use the earlier one; never infer renewal.
  return dates.sort()[0];
}
async function visibleButton(page: Page, names: string[]) {
  const buttons = [];
  for (const b of await page.$$('button')) if (await b.isVisible() && await b.evaluate((x, values) => values.includes(x.textContent?.trim() || '') || values.includes(x.getAttribute('aria-label') || ''), names)) buttons.push(b);
  if (buttons.length !== 1) throw Error('GOOGLE_UI_BUTTON_CHANGED');
  return buttons[0];
}
async function identity(page: Page): Promise<void> {
  if (new URL(page.url()).origin !== 'https://myaccount.google.com') throw Error('GOOGLE_SIGNIN_REQUIRED');
  const labels = await page.$$eval('[aria-label]', nodes => nodes.map(x => x.getAttribute('aria-label') || '').filter(x => x.startsWith('Google Account:')));
  if (labels.length !== 1 || !labels[0].includes(`(${FAMILY_MANAGER})`)) throw Error('GOOGLE_ACCOUNT_MISMATCH');
}
export function googleFamilyDriver(page: Page): FamilyDriver {
  let previous: FamilyView | undefined;
  let membership: { through?: string; checkedAt: number } | undefined;
  async function family() {
    await page.goto(familyURL, { waitUntil: 'networkidle2', timeout: 45000 }); await identity(page);
    const data = await page.evaluate(() => ({ text: document.body.innerText,
      invite: document.querySelector('a[href="family/invitemembers"]')?.getAttribute('aria-label'),
      entries: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="family/member/"]')].map(x => ({ href: x.getAttribute('href')!, text: x.innerText })),
      subscribed: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].some(x => x.href.startsWith('https://www.youtube.com/') && x.innerText.includes('Subscribed')) }));
    if (!data.text.includes('Your family on Google') || data.entries.filter(x => x.text.includes('Family manager')).length !== 1) throw Error('GOOGLE_FAMILY_MANAGER_REQUIRED');
    const match = data.invite?.match(/^Send invitations \(([0-5])\)$/);
    if (data.invite && !match) throw Error('GOOGLE_FAMILY_CAPACITY_CHANGED');
    const remaining = match ? Number(match[1]) : 0, entries = data.entries.filter(x => !x.text.includes('Family manager'));
    if (entries.length + remaining !== 5 || entries.some(x => !/^family\/member\/[a-z]\/[-\w]+$/.test(x.href))) throw Error('GOOGLE_FAMILY_ROSTER_CHANGED');
    return { ...data, remaining, entries };
  }
  const driver: FamilyDriver = {
    async inspect() {
      const initial = await family(), members: string[] = [];
      for (const entry of initial.entries) {
        await page.goto(`https://myaccount.google.com/${entry.href}?hl=en`, { waitUntil: 'networkidle2', timeout: 45000 }); await identity(page);
        const text = await page.$eval('body', x => x.innerText);
        if (!text.includes('Family member details')) throw Error('GOOGLE_MEMBER_DETAIL_CHANGED');
        const emails = [...new Set(text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [])];
        if (emails.length !== 1 || canonicalGoogleEmail(emails[0]) === canonicalGoogleEmail(FAMILY_MANAGER)) throw Error('GOOGLE_MEMBER_EMAIL_REQUIRED');
        members.push(emails[0]);
      }
      const fresh = await family();
      if (fresh.remaining !== initial.remaining || JSON.stringify(fresh.entries) !== JSON.stringify(initial.entries)) throw Error('GOOGLE_FAMILY_CHANGED');
      if (!membership || Date.now() - membership.checkedAt > 120000) {
      await page.goto('https://www.youtube.com/paid_memberships?hl=en', { waitUntil: 'networkidle2', timeout: 45000 });
      if (new URL(page.url()).origin !== 'https://www.youtube.com') throw Error('YOUTUBE_SIGNIN_REQUIRED');
      const menu = await visibleButton(page, ['Account menu', 'Menu akun']); await menu.click();
      await page.waitForFunction(email => document.body.innerText.includes(email), { timeout: 10000 }, FAMILY_MANAGER);
      const accountEmails = await page.$$eval('ytd-multi-page-menu-renderer #email', nodes => nodes.map(x => x.textContent?.trim()).filter(Boolean));
      if (accountEmails.length !== 1 || accountEmails[0] !== FAMILY_MANAGER) throw Error('YOUTUBE_ACCOUNT_MISMATCH');
      await page.keyboard.press('Escape');
      await (await visibleButton(page, ['Manage membership', 'Kelola langganan'])).click();
      await page.waitForFunction(() => /Langganan keluarga:|Family membership:/.test(document.body.innerText), { timeout: 10000 });
      membership = { through: membershipBenefitsDate(await page.$eval('body', x => x.innerText)), checkedAt: Date.now() };
      }
      previous = { manager: FAMILY_MANAGER, members, remaining: fresh.remaining, subscribed: fresh.subscribed, benefitsThrough: membership.through };
      return previous;
    },
    async invite(email, beforeSend) {
      const prior = previous;
      if (!prior) throw Error('FAMILY_INSPECTION_REQUIRED');
      const current = await driver.inspect();
      if (!current.subscribed || !current.benefitsThrough || !prior.benefitsThrough || current.benefitsThrough < prior.benefitsThrough
        || current.remaining < 1 || current.members.some(x => canonicalGoogleEmail(x) === canonicalGoogleEmail(email))) throw Error('FAMILY_CHANGED_BEFORE_SEND');
      await family();
      await page.click('a[href="family/invitemembers"]');
      const input = 'input[placeholder="Type a name or email"]';
      await page.waitForSelector(input, { visible: true, timeout: 10000 }); await identity(page);
      await page.type(input, email);
      await page.waitForFunction(value => [...document.querySelectorAll('[role="option"][pkd-target]')].some(x => x.getAttribute('pkd-target') === `1:${value};${value}`), { timeout: 10000 }, email);
      const options = await page.$$('[role="option"][pkd-target]');
      const matches = [];
      for (const option of options) if (await option.evaluate((x, value) => x.getAttribute('pkd-target') === `1:${value};${value}`, email)) matches.push(option);
      if (matches.length !== 1) throw Error('GOOGLE_RECIPIENT_PICKER_CHANGED');
      await matches[0].click();
      const selected = await page.$$eval('[aria-label="Search Field"] [role="option"][data-hovercard-id]', nodes => nodes.map(x => x.getAttribute('data-hovercard-id')));
      if (selected.length !== 1 || selected[0] !== email || await page.$eval(input, x => x.value) !== '') throw Error('GOOGLE_RECIPIENT_MISMATCH');
      const send = await visibleButton(page, ['Send']);
      if (await send.evaluate(x => x.disabled || x.getAttribute('aria-disabled') === 'true')) throw Error('GOOGLE_SEND_DISABLED');
      await identity(page);
      if (new URL(page.url()).pathname !== '/family/invitemembers') throw Error('GOOGLE_INVITE_PAGE_CHANGED');
      await beforeSend(); // durable reservation plus latest buyer/safe-mode validation
      await send.click(); // exactly one external send; all failures are lookup-only afterwards
      await page.waitForFunction(() => location.pathname === '/family/details', { timeout: 15000 });
    },
  };
  return driver;
}
