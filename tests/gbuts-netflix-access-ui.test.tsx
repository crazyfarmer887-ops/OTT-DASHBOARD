// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import PartyAccessPage from '../src/web/pages/party-access';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let dispose: (() => void) | undefined;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); });
const payload = {
  ok: true, serviceType: '넷플릭스', presentation: 'gbuts-netflix-numbered', memberName: '구매자',
  credentials: { id: 'test@example.com', password: 'test-password', pin: '123456', updatedAt: '' },
  emailAccessUrl: 'https://email-verify.one/email/mail/test-alias', partyProfiles: [],
};
async function render(value: object) {
  window.history.replaceState(null, '', '/dashboard/access/test-token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => value }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  await act(async () => root.render(<PartyAccessPage />));
  return host;
}
test('numbered view has three credentials, no profile grid or separate mail link, and opens the existing PIN-gated mail view', async () => {
  const host = await render(payload);
  expect(host.textContent).toContain('test@example.com'); expect(host.textContent).toContain('test-password'); expect(host.textContent).toContain('123456');
  expect(host.querySelector('[aria-label="파티원 프로필"]')).toBeNull();
  expect(host.textContent).not.toContain('프로필이 꽉 찼다면');
  expect(host.textContent).toContain('프로필 이름·PIN 변경');
  expect(host.querySelector('a[href*="/email/mail/"]')).toBeNull(); expect(host.querySelector('iframe')).toBeNull();
  const open = [...host.querySelectorAll('button')].find(button => button.textContent === '가구 인증·로그인 코드 확인')!;
  await act(async () => open.click());
  expect(host.querySelector('iframe')?.getAttribute('src')).toBe(payload.emailAccessUrl);
  expect(host.textContent).toContain('이메일 PIN을 입력한 뒤');
});
test('redacted compact payload retains consent and shows no credentials or mail frame', async () => {
  const host = await render({ ...payload, credentials: undefined, emailAccessUrl: undefined, consentRequired: true, sensitiveRedacted: true });
  expect(host.textContent).toContain('이용 전 필수 동의'); expect(host.textContent).not.toContain('test-password');
  expect(host.querySelector('iframe')).toBeNull(); expect(host.querySelector('[aria-label="파티원 프로필"]')).toBeNull();
  expect(host.querySelector('img')).toBeNull();
});
test('foreign mail URLs cannot open a frame and legacy GrayTag presentation remains intact', async () => {
  const host = await render({ ...payload, presentation: undefined, profileName: '감귤', emailAccessUrl: 'https://foreign.example/mail' });
  expect(host.querySelector('[aria-label="파티원 프로필"]')).not.toBeNull();
  expect(host.textContent).toContain('프로필이 꽉 찼다면');
  expect(host.querySelector('iframe')).toBeNull();
});
