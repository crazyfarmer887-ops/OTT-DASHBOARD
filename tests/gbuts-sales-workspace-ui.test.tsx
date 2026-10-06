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
