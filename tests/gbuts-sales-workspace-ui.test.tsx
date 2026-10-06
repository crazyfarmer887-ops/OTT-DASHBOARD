// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { afterEach, expect, test, vi } from 'vitest';
import GbutsSalesPage from '../src/web/pages/gbuts-sales';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let dispose: (() => void) | undefined;
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); });

test('query navigation replaces the selected account and all listing defaults with the chosen service', async () => {
  const accounts = ['넷플릭스', '디즈니플러스'].map((serviceType, i) => ({ key: `account-${i}`, serviceType,
    accountEmail: `account-${i}@example.com`, available: 2, endDate: '2027-10-01', suggestedDailyPrice: 150 + i }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, enabled: true,
    accounts, listings: [], orders: [], unlinked: [], lastSuccess: null, lastError: null }) }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('넷플릭스'));
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));
  const account = () => host.querySelector<HTMLSelectElement>('[aria-label="판매 계정"]')!;
  expect(account().value).toBe('account-0');
  await act(async () => { window.history.pushState(null, '', '/gbuts-sales?service=' + encodeURIComponent('디즈니플러스')); });
  expect(account().value).toBe('account-1');
  expect(account().options).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('[aria-label="하루 요금"]')!.value).toBe('151');
  await act(async () => { window.history.pushState(null, '', '/gbuts-sales'); });
  expect(account().value).toBe('');
  expect(account().options).toHaveLength(3);
  expect(host.querySelector<HTMLInputElement>('[aria-label="하루 요금"]')!.value).toBe('');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('account management handoff selects the exact newly registered account rather than the first account of its service', async () => {
  const accounts = ['older', 'new'].map(name => ({ key: `넷플릭스:${name}@example.com`, serviceType: '넷플릭스',
    accountEmail: `${name}@example.com`, available: 2, endDate: '2099-10-01', suggestedDailyPrice: 150 }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, enabled: true, accounts, listings: [], orders: [], unlinked: [] }) }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('넷플릭스') + '&account=new%40example.com');
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="판매 계정"]')!.value).toBe('넷플릭스:new@example.com');
  await act(async () => { window.history.pushState(null, '', '/gbuts-sales?service=' + encodeURIComponent('넷플릭스') + '&account=older%40example.com'); });
  expect(host.querySelector<HTMLSelectElement>('[aria-label="판매 계정"]')!.value).toBe('넷플릭스:older@example.com');
});

test('a newly registered account without a suggested daily price defaults to 150 won and can be registered', async () => {
  const accounts = [{ key: '넷플릭스:new@example.com', serviceType: '넷플릭스', accountEmail: 'new@example.com',
    total: 5, graytag: 0, manual: 0, gbuts: 0, claims: 0, available: 5, overbooked: false,
    endDate: '2099-10-01', suggestedDailyPrice: null }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, enabled: true,
    accounts, listings: [], orders: [], unlinked: [] }) }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('넷플릭스') + '&account=new%40example.com');
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));

  expect(host.querySelector<HTMLSelectElement>('[aria-label="판매 계정"]')!.value).toBe('넷플릭스:new@example.com');
  expect.soft(host.querySelector<HTMLInputElement>('[aria-label="하루 요금"]')!.value).toBe('150');
  const register = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '벗츠 판매글 등록')!;
  expect(register.disabled).toBe(false);
  const account = host.querySelector<HTMLSelectElement>('[aria-label="판매 계정"]')!;
  await act(async () => { account.value = ''; account.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(account.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('[aria-label="하루 요금"]')!.value).toBe('');
  expect(register.disabled).toBe(true);
});

test('clearing the daily price explains why registration is blocked and entering a valid price enables it again', async () => {
  const accounts = [{ key: '넷플릭스:new@example.com', serviceType: '넷플릭스', accountEmail: 'new@example.com',
    total: 5, graytag: 0, manual: 0, gbuts: 0, claims: 0, available: 5, overbooked: false,
    endDate: '2099-10-01', suggestedDailyPrice: null }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, enabled: true,
    accounts, listings: [], orders: [], unlinked: [] }) }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  window.history.replaceState(null, '', '/gbuts-sales?service=' + encodeURIComponent('넷플릭스') + '&account=new%40example.com');
  await act(async () => root.render(<Router><GbutsSalesPage /></Router>));
  const price = host.querySelector<HTMLInputElement>('[aria-label="하루 요금"]')!;
  const register = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '벗츠 판매글 등록')!;
  const changePrice = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(price, value);
    price.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await changePrice('');
  expect(host.querySelector('[role="status"]')?.textContent).toContain('하루 요금');
  expect(register.disabled).toBe(true);
  await act(async () => register.click());
  expect(fetch).not.toHaveBeenCalledWith('/api/gbuts/ott/listings', expect.objectContaining({ method: 'POST' }));

  await changePrice('150');
  expect(register.disabled).toBe(false);
  expect(host.querySelector('[role="status"]')).toBeNull();
});
