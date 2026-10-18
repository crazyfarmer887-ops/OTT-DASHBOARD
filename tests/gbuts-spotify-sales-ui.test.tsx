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
it('deletes only after confirmation and removes the closed listing from the displayed list', async () => {
  const template = { sourcePostSeq: 15557, title: '등록 양식', description: '판매 안내',
    noticeBeforeOrder: null, noticeAfterOrder: null, startDate: '2098-10-18', endDate: '2099-10-17', dailyPrice: 140, capacity: 5 };
  let deleted = false;
  const transport = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') deleted = true;
    return { ok: true, json: async () => init?.method === 'DELETE' ? { ok: true }
      : { ok: true, enabled: true, template, listings: deleted ? [] : [{ ...template, id: 'registered-id', postSeq: 17000, state: 'registered', title: '삭제할 판매글' }] } };
  });
  const confirm = vi.fn(() => false); vi.stubGlobal('confirm', confirm); vi.stubGlobal('fetch', transport);
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('스포티파이'));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));
  const remove = () => [...host.querySelectorAll('button')].find(button => button.textContent === '삭제')!;
  await act(async () => remove().click());
  expect(transport.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  confirm.mockReturnValue(true);
  await act(async () => remove().click());
  expect(transport.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toEqual([
    ['/api/gbuts/spotify/listings/registered-id', { method: 'DELETE' }],
  ]);
  expect(host.textContent).not.toContain('삭제할 판매글');
  expect(host.textContent).toContain('기존 구매자 자동 안내는 계속됩니다');
});
it('applies period presets, updates the end date when the start changes, and sends the chosen period', async () => {
  const template = { sourcePostSeq: 15557, title: 'Spotify', description: '판매 안내', noticeBeforeOrder: null,
    noticeAfterOrder: null, startDate: '2098-01-31', endDate: '2099-01-30', dailyPrice: 140, capacity: 5 };
  const transport = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST'
    ? { ok: true, listing: { postSeq: 17000 } } : { ok: true, enabled: true, template, listings: [] } }));
  vi.stubGlobal('fetch', transport);
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('스포티파이'));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '1달')!.click());
  expect(host.querySelector<HTMLInputElement>('[aria-label="이용 종료일"]')!.value).toBe('2098-02-28');
  const start = host.querySelector<HTMLInputElement>('[aria-label="이용 시작일"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(start, '2098-03-18');
    start.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector<HTMLInputElement>('[aria-label="이용 종료일"]')!.value).toBe('2098-04-17');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const first = JSON.parse(String(transport.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body));
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '3달')!.click());
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const last = JSON.parse(String(transport.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)![1]!.body));
  expect(first).toMatchObject({ startDate: '2098-03-18', endDate: '2098-04-17' });
  expect(last.endDate).toBe('2098-06-17'); expect(last.requestId).not.toBe(first.requestId);
});
