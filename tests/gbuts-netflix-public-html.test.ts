import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';
import { buildPartyAccessHtml, partyAccessContentSecurityPolicy } from '../src/lib/party-access-page-html';
const payload = { ok: true, presentation: 'gbuts-netflix-numbered', serviceType: '넷플릭스', memberName: 'test', credentials: { id: 'test@example.com', password: 'test-password', pin: '123456' }, emailAccessUrl: 'https://email-verify.one/email/mail/test-alias' };
async function page(initial: object, full = payload) {
  const fetch = vi.fn().mockResolvedValueOnce({ json: async () => initial }).mockResolvedValue({ json: async () => full });
  const dom = new JSDOM(buildPartyAccessHtml('test-token', 'test-nonce'), { url: 'https://email-verify.one/dashboard/access/test-token', runScripts: 'dangerously', beforeParse(window) {
    Object.defineProperty(window, 'fetch', { value: fetch });
    window.HTMLElement.prototype.scrollIntoView = () => {};
  } });
  await new Promise(resolve => setTimeout(resolve, 1));
  return { dom, document: dom.window.document, fetch };
}
test('the actual public HTML renderer preserves consent then displays compact credentials and an embedded PIN-gated mail URL', async () => {
  const f = await page({ ...payload, credentials: undefined, emailAccessUrl: undefined, sensitiveRedacted: true });
  try {
    expect(f.document.body.textContent).not.toContain('test-password');
    expect(f.document.querySelector('img')).toBeNull();
    for (const phrase of ['계정 정보를 절대 변경하지 않겠습니다.', '로그인 안 될 때 이 페이지를 먼저 확인하겠습니다.', '배정된 1개 프로필만 사용하겠습니다.']) {
      const input = f.document.querySelector('textarea')!; input.value = phrase; input.dispatchEvent(new f.dom.window.Event('input'));
      [...f.document.querySelectorAll<HTMLButtonElement>('.primary')].find(button => button.textContent!.includes('동의'))!.click();
    }
    await new Promise(resolve => setTimeout(resolve, 1));
    const root = f.document.getElementById('root')!;
    expect(root.textContent).toContain('test@example.com'); expect(root.textContent).toContain('test-password'); expect(root.textContent).toContain('123456');
    expect(root.querySelector('.profile-picker')).toBeNull(); expect(root.textContent).not.toContain('프로필이 꽉 찼다면');
    expect(root.querySelector('a[href*="/email/mail/"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('.email-access-button')!.click();
    expect(root.querySelector('iframe')?.getAttribute('src')).toBe(payload.emailAccessUrl);
    expect(root.textContent).toContain('이메일 PIN을 입력한 뒤');
    expect(f.fetch.mock.calls[1][0]).toBe('/api/party-access/test-token/consent');
    expect(partyAccessContentSecurityPolicy('test-nonce')).toContain('frame-src https://email-verify.one/email/mail/;');
    expect(partyAccessContentSecurityPolicy('test-nonce')).toContain("script-src 'nonce-test-nonce'");
  } finally { f.dom.window.close(); }
});
test('the public renderer retains GrayTag profiles and rejects a foreign mail frame for compact buyers', async () => {
  const legacy = await page({ ...payload, presentation: undefined, profileName: '감귤' });
  try { expect(legacy.document.querySelector('.profile-picker')).not.toBeNull(); } finally { legacy.dom.window.close(); }
  const foreign = await page({ ...payload, emailAccessUrl: 'https://other.example/email/mail/1' });
  try { expect(foreign.document.querySelector('iframe')).toBeNull(); expect(foreign.document.querySelector('.email-access-button')).toBeNull(); } finally { foreign.dom.window.close(); }
});

test('numbered Disney public HTML shows profile creation and password-only login without any mailbox controls', async () => {
 const f=await page({...payload,presentation:'gbuts-disney-numbered',serviceType:'디즈니플러스',profileName:'6'});
 try {expect(f.document.body.textContent).toContain('프로필 6번을 새로 만들어');expect(f.document.body.textContent).toContain('ID·비밀번호 로그인');expect(f.document.querySelector('.email-access-button')).toBeNull();expect(f.document.querySelector('.profile-picker')).toBeNull();expect(f.document.getElementById('root')!.textContent).not.toContain('프로필이 꽉 찼다면');} finally {f.dom.window.close();}
});

 test('configured Disney mailbox opens the matching Tinyhost page directly without PIN or iframe', async () => {
 const email='mailbox@example.com';
 const f=await page({...payload,presentation:'gbuts-disney-numbered',serviceType:'디즈니플러스',profileName:'1',accountEmail:email,emailAccessUrl:'https://tinyhost.shop/'+email});
 try {const root=f.document.getElementById('root')!;const link=root.querySelector<HTMLAnchorElement>('a[href^="https://tinyhost.shop/"]');expect(link?.href).toBe('https://tinyhost.shop/'+email);expect(link?.target).toBe('_blank');expect(link?.rel).toBe('noreferrer');expect(root.textContent).toContain('TV 등에서 이메일 인증 코드를 요구하면');expect(root.querySelector('iframe')).toBeNull();expect(root.textContent).not.toContain('PIN을 먼저');} finally {f.dom.window.close();}
 const other=await page({...payload,presentation:'gbuts-disney-numbered',serviceType:'디즈니플러스',accountEmail:email,emailAccessUrl:'https://tinyhost.shop/other@example.com'});
 try {expect(other.document.getElementById('root')!.querySelector('a[href^="https://tinyhost.shop/"]')).toBeNull();} finally {other.dom.window.close();}
});
