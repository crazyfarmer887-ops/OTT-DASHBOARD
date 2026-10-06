// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { afterEach, expect, test, vi } from 'vitest';
import GbutsAccountsPage from '../src/web/pages/gbuts-accounts';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let dispose: (() => void) | undefined;
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); });

test('registers credentials before publication and restores pending accounts after reopening', async () => {
  const account = { id: 'manual-1', serviceType: '넷플릭스', email: 'new@example.com', password: 'secret!', pin: '', paymentStatus: 'pending', expiryDate: null };
  const transport = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ accounts: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, account }) })
    .mockResolvedValue({ ok: true, json: async () => ({ accounts: [account] }) });
  vi.stubGlobal('fetch', transport);
  const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
  dispose = () => { root.unmount(); host.remove(); };
  window.history.replaceState(null, '', '/gbuts-accounts');
  await act(async () => root.render(<Router><GbutsAccountsPage /></Router>));
  const inputs = host.querySelectorAll<HTMLInputElement>('form input');
  const fill = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await fill(inputs[0], account.email); await fill(inputs[1], account.password);
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(transport.mock.calls[1][0]).toBe('/api/generated-accounts/register');
  expect(JSON.parse(transport.mock.calls[1][1].body)).toMatchObject({ email: 'new@example.com', password: 'secret!', paymentStatus: 'pending' });
  expect(host.textContent).toContain('등록한 계정 1개');
  const write = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '판매글 작성')!;
  expect(write().disabled).toBe(true);
  await act(async () => { root.unmount(); root = createRoot(host); root.render(<Router><GbutsAccountsPage /></Router>); });
  expect(host.textContent).toContain('new@example.com'); expect(write().disabled).toBe(true);
  expect(transport.mock.calls.some(([url]) => url.includes('/listings'))).toBe(false);
});
