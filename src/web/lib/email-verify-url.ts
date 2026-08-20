export function safeEmailVerifyUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'email-verify.one') return '';
    if (!/^\/email\/mail\/[^/]+\/?$/.test(parsed.pathname)) return '';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}
