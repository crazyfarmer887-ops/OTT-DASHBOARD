// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import LinkidPage from '../src/web/pages/linkid';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); document.body.innerHTML = ''; });
it('opens the notification deep link on the correct login/profile and switches without leaking another profile chat', async () => {
  window.history.replaceState({}, '', '/dashboard/linkid?account=two&profile=2');
  const profile = { index: 2, uid: 22, name: '두 번째 프로필', money: 1000, newAlarm: false };
  const data = { ok: true, enabled: true, intervalSeconds: 90, syncing: false, accounts: [
    { id: 'one', label: '첫 로그인', profiles: [{ ...profile, index: 1 }], snapshots: {}, enabled: true, pendingAlerts: 0 },
    { id: 'two', label: '두 번째 로그인', profiles: [{ ...profile, index: 1, name: '첫 프로필' }, profile], enabled: true, pendingAlerts: 0,
      snapshots: { '2': { profile, updatedAt: '2026-10-12T03:00:00Z', parties: [{ id: 77, service: '마이크로소프트 365', owner: true, startDate: '2026-10-12', endDate: '2027-10-12', members: 2, capacity: 6, participants: [] }], notices: [],
        rooms: [{ id: 10, partyId: 77, ownerId: 22, memberId: 33, name: '구매자', messages: [{ id: 1, writer: 33, date: '2026-10-12 12:00:00', text: '<img src=x onerror=bad> 이메일 남겼어요' }] }] } } },
  ] };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<LinkidPage />); });
  expect((container.querySelector('select') as HTMLSelectElement).value).toBe('two');
  expect(container.textContent).toContain('2027-10-11'); expect(container.textContent).toContain('프로필 2 · 두 번째 프로필');
  const chat = [...container.querySelectorAll('button')].find(x => x.textContent?.startsWith('구매자 ·'))!;
  await act(async () => { chat.click(); }); expect(container.textContent).toContain('이메일 남겼어요'); expect(container.querySelector('img')).toBeNull();
  const firstProfile = [...container.querySelectorAll('button')].find(x => x.textContent?.startsWith('1. 첫 프로필'))!;
  await act(async () => { firstProfile.click(); }); expect(container.textContent).not.toContain('이메일 남겼어요');
  await act(async () => { root.unmount(); });
});
