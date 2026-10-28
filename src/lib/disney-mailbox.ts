/** Only explicitly configured Disney accounts expose a third-party mailbox. */
export function tinyhostMailboxUrl(email: string): string {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return '';
  return `https://tinyhost.shop/${encodeURIComponent(value).replace(/%40/g, '@')}`;
}

/** Never let a buyer-page payload point at another account's mailbox. */
export function safeTinyhostEmailAccessUrl(value: unknown, accountEmail: unknown): string {
  try {
    const url = new URL(String(value || '').trim());
    const email = String(accountEmail || '').trim().toLowerCase();
    if (!email || url.origin !== 'https://tinyhost.shop' || url.username || url.password || url.search || url.hash
      || decodeURIComponent(url.pathname) !== `/${email}`) return '';
    return url.toString();
  } catch { return ''; }
}

/** Exact-address mailbox only: never accept the admin dashboard or a different alias. */
export function safeDisneyEmailAccessUrl(value: unknown, accountEmail: unknown): string {
  try {
    const url = new URL(String(value || '').trim());
    const email = String(accountEmail || '').trim().toLowerCase();
    if (!email || url.username || url.password || url.search || url.hash) return '';
    const path = decodeURIComponent(url.pathname);
    if (url.origin === 'https://tinyhost.shop' && path === `/${email}`) return url.toString();
    if (url.origin === 'https://email-verify.one' && path === `/email/mail/${email}`) return url.toString();
    return '';
  } catch { return ''; }
}
export function emailVerifyDisneyMailboxUrl(email: string): string {
  return safeDisneyEmailAccessUrl(`https://email-verify.one/email/mail/${encodeURIComponent(email.trim().toLowerCase())}`, email);
}
