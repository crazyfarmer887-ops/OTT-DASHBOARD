import type { Page } from 'puppeteer-core';

/** One paid task per fresh credential check, shared across its login steps. */
export function createNbaCaptchaHandler() {
  const state = {
    enabled: process.env.NBA_CAPSOLVER_ENABLED === 'true', attempted: false, solved: false,
    async solve(page: Page): Promise<boolean> {
      if (!state.enabled || state.attempted) return false;
      state.attempted = true;
      state.solved = await solveNbaCaptcha(page);
      return state.solved;
    },
  };
  return state;
}
export type NbaCaptchaHandler = ReturnType<typeof createNbaCaptchaHandler>;

async function solveNbaCaptcha(page: Page): Promise<boolean> {
  const key = process.env.CAPSOLVER_API_KEY?.trim();
  if (!key || /[\r\n]/.test(key)) return false;
  try {
    const challenge = await page.evaluate(() => {
      if (location.origin !== 'https://www.nba.com' || location.pathname !== '/account/sign-in') return null;
      if (/verification code|security code|verify your identity|too many (requests|attempts)|temporarily blocked|unusual activity|보안 인증|인증 ?코드/i.test(document.body.innerText)) return null;
      const frames = [...document.querySelectorAll('iframe')].filter(el => el.checkVisibility({ visibilityProperty: true }) && /^https:\/\//.test(el.src)
        && ['https://www.google.com', 'https://www.recaptcha.net'].includes(new URL(el.src).origin)
        && /^\/recaptcha\/(api2|enterprise)\/anchor$/.test(new URL(el.src).pathname)
        && new URL(el.src).searchParams.get('size') !== 'invisible');
      if (frames.length !== 1) return null;
      const url = new URL(frames[0].src);
      return { websiteURL: location.origin + location.pathname, websiteKey: url.searchParams.get('k'),
        pageAction: url.searchParams.get('sa'), s: url.searchParams.get('s'), enterprise: url.pathname.includes('/enterprise/') };
    });
    if (!challenge?.websiteKey) return false;
    const deadline = Date.now() + 120000;
    const request = async (method: 'createTask' | 'getTaskResult', data: object) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('NBA_CAPTCHA_TIMEOUT');
      const response = await fetch(`https://api.capsolver.com/${method}`, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey: key, ...data }),
        signal: AbortSignal.timeout(Math.min(20000, remaining)) });
      if (!response.ok) throw new Error('NBA_CAPTCHA_PROVIDER_FAILED');
      const value = await response.json();
      if (!value || value.errorId !== 0) throw new Error('NBA_CAPTCHA_PROVIDER_FAILED');
      return value;
    };
    const task = { type: challenge.enterprise ? 'ReCaptchaV2EnterpriseTaskProxyLess' : 'ReCaptchaV2TaskProxyLess',
      websiteURL: challenge.websiteURL, websiteKey: challenge.websiteKey, isInvisible: false,
      ...(challenge.pageAction ? { pageAction: challenge.pageAction } : {}),
      ...(challenge.s ? challenge.enterprise ? { enterprisePayload: { s: challenge.s } } : { recaptchaDataSValue: challenge.s } : {}) };
    const created = await request('createTask', { task });
    if (typeof created.taskId !== 'string' || !created.taskId) return false;
    let token: unknown;
    while (Date.now() + 3000 < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      // Keep Steel alive without letting a stalled CDP command extend the solver budget.
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([page.title(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('NBA_CAPTCHA_TIMEOUT')), remaining);
        })]);
      } finally { clearTimeout(timer); }
      // On timeout the caller returns unconfirmed and closes the browser, cancelling pending CDP work.
      const result = await request('getTaskResult', { taskId: created.taskId });
      if (result.status === 'ready') { token = result.solution?.gRecaptchaResponse; break; }
      if (!['idle', 'processing'].includes(result.status)) return false;
    }
    if (typeof token !== 'string' || token.length < 20 || token.length > 30000) return false;
    return await page.evaluate(({ token, websiteKey }) => {
      // Keep serialized callbacks self-contained; no external tsx __name helpers.
      const clients = (window as Window & { ___grecaptcha_cfg?: { clients?: Record<string, unknown> } }).___grecaptcha_cfg?.clients;
      if (!clients) return false;
      const queue = Object.entries(clients).filter(([id]) => Number(id) < 10000).map(([, value]) => ({ value, depth: 0 }));
      const seen = new Set(); const matches: Record<string, unknown>[] = []; let inspected = 0;
      while (queue.length && inspected++ < 1000) {
        const item = queue.shift()!; const value = item.value;
        if (!value || typeof value !== 'object' || seen.has(value) || value instanceof Node || item.depth > 5) continue;
        seen.add(value); const object = value as Record<string, unknown>;
        if (object.sitekey === websiteKey && object.size !== 'invisible' && typeof object.callback === 'function') matches.push(object);
        for (const name of Object.keys(object)) {
          const child = Object.getOwnPropertyDescriptor(object, name)?.value;
          if (child && typeof child === 'object') queue.push({ value: child, depth: item.depth + 1 });
        }
      }
      if (matches.length !== 1) return false;
      const callback = matches[0].callback; if (typeof callback !== 'function') return false;
      const frame = [...document.querySelectorAll('iframe')].find(el => /\/recaptcha\/(api2|enterprise)\/anchor/.test(el.src)
        && new URL(el.src).searchParams.get('k') === websiteKey && new URL(el.src).searchParams.get('size') !== 'invisible');
      let scope = frame?.parentElement; let textarea: HTMLTextAreaElement | null = null;
      while (scope && scope !== document.body && !textarea) { textarea = scope.querySelector('textarea[name="g-recaptcha-response"]'); scope = scope.parentElement; }
      if (textarea) { textarea.value = token; textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true })); }
      callback.call(matches[0], token);
      return true;
    }, { token, websiteKey: challenge.websiteKey });
  } catch { return false; } // Provider errors/tokens must never escape into logs or account-password claims.
}
