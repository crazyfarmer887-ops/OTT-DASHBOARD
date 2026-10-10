/** Supplier links are read here; no Microsoft invitation is accepted by this module. */
export function parseOfficeSupplyUrl(value: string): { url: string; linkId: string } {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('올바른 micro365.ren 공급 링크를 입력해주세요.'); }
  const match = url.pathname.match(/^\/(?:1m|6m|1y|2y)\/([A-Za-z0-9_-]{1,100})$/);
  if (url.protocol !== 'https:' || url.hostname !== 'micro365.ren' || url.port || url.username || url.password || url.search || url.hash || !match)
    throw new Error('올바른 micro365.ren 공급 링크를 입력해주세요.');
  return { url: url.href, linkId: match[1] };
}

function htmlTagAttributes(html: string, tag: 'a' | 'form'): Map<string, string>[] {
  const tags = html.matchAll(/<([a-z][a-z0-9:-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi);
  return [...tags].filter(match => match[1].toLowerCase() === tag).map(match => {
    const attributes = new Map<string, string>();
    const body = match[0].slice(tag.length + 1, -1);
    for (const attr of body.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = attr[1].toLowerCase();
      // HTML uses the first occurrence of a duplicate attribute.
      if (!attributes.has(name)) attributes.set(name, attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    return attributes;
  });
}

export function parseOfficeInvitationPage(html: string): { kind: 'invitation'; url: string } | { kind: 'verification' | 'unavailable' } {
  // Ignore script/comment text: only an actual anchor can supply the destination.
  const visible = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  if (htmlTagAttributes(visible, 'form').some(attrs => attrs.get('id') === 'verifyForm')) return { kind: 'verification' };
  const links = new Set<string>();
  for (const attrs of htmlTagAttributes(visible, 'a')) {
    const raw = attrs.get('href');
    if (!raw) continue;
    const href = raw.replace(/&amp;/gi, '&').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd';
    });
    try {
      const url = new URL(href);
      if (url.protocol === 'https:' && url.hostname === 'aka.ms' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/[A-Za-z0-9_-]{8,128}$/.test(url.pathname)) links.add(url.href);
    } catch { /* Ignore unrelated and relative navigation. */ }
  }
  if (links.size > 1) throw new Error('초대 링크가 여러 개라 확인이 필요합니다.');
  return links.size ? { kind: 'invitation', url: [...links][0] } : { kind: 'unavailable' };
}

type SupplyRequest = typeof fetch;
export async function resolveOfficeInvitation(source: string, verificationEmail?: string, request: SupplyRequest = fetch): Promise<string> {
  const { url, linkId } = parseOfficeSupplyUrl(source);
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: url, Origin: 'https://micro365.ren' };
  const options = { redirect: 'manual' as const, signal: AbortSignal.timeout(15000) };
  const response = await request(url, { ...options, headers });
  if (!response.ok) throw new Error('공급 사이트 응답을 확인하지 못했습니다.');
  let page = parseOfficeInvitationPage(await response.text());
  if (page.kind === 'verification') {
    if (!verificationEmail?.trim()) throw new Error('이 링크는 등록 당시 이메일이 필요합니다.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verificationEmail.trim())) throw new Error('이메일 확인이 필요합니다.');
    const verify = await request('https://micro365.ren/api/link/verify', { ...options, signal: AbortSignal.timeout(15000), method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ link_id: linkId, email: verificationEmail.trim() }) });
    const result = await verify.json().catch(() => null);
    if (!verify.ok || result?.ok !== true) throw new Error('공급 링크의 등록 이메일 확인에 실패했습니다. 자동 재시도하지 않습니다.');
    const cookies = verify.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
    if (!cookies) throw new Error('공급 링크 인증 정보를 확인하지 못했습니다.');
    const status = await request(url, { ...options, signal: AbortSignal.timeout(15000), headers: { ...headers, Cookie: cookies } });
    if (!status.ok) throw new Error('공급 링크 상태 조회에 실패했습니다.');
    page = parseOfficeInvitationPage(await status.text());
  }
  if (page.kind !== 'invitation') throw new Error('초대 주소를 읽지 못했습니다. 미사용 공급 링크의 발급 단계를 확인해야 합니다.');
  return page.url;
}
