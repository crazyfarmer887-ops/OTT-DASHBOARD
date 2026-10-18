// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { afterEach, expect, it, vi } from 'vitest';
import GbutsSalesPage from '../src/web/pages/gbuts-sales';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let dispose: (() => void) | undefined;
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); });
it('opens Spotify registration in the sales dashboard with the original wording and submits only that form', async () => {
  const template = { sourcePostSeq: 15557, title: '[스포티파이] 이전 판매글', description: '기존 안내 문구\n두 번째 줄',
    noticeBeforeOrder: '기존 구매 전 안내', noticeAfterOrder: null, startDate: '2098-10-18', endDate: '2099-10-17', dailyPrice: 140, capacity: 5 };
  const transport = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST'
    ? { ok: true, listing: { postSeq: 17000 } } : { ok: true, enabled: true, template, listings: [] } }));
  vi.stubGlobal('fetch', transport);
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('스포티파이'));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));
  expect(host.querySelector<HTMLInputElement>('[aria-label="제목"]')!.value).toBe(template.title);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="판매 내용"]')!.value).toBe(template.description);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="구매 전 안내"]')!.value).toBe(template.noticeBeforeOrder);
  expect(host.querySelector<HTMLInputElement>('[aria-label="하루 요금"]')!.value).toBe('140');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const writes = transport.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1); expect(writes[0][0]).toBe('/api/gbuts/spotify/listings');
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject(template);
  expect(host.textContent).toContain('17000 등록 완료');
  expect(transport.mock.calls.some(([url]) => url === '/api/gbuts/ott')).toBe(false);
});
