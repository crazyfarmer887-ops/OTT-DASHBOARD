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
