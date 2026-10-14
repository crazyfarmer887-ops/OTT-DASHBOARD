// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import CredentialField from '../src/web/components/credential-field';
import { copyTextToClipboard } from '../src/web/lib/clipboard';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(async () => { await act(async () => cleanup?.()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows the stored password, toggles visibility and copies the exact value without submitting', async () => {
  const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const submit = vi.fn(); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  cleanup = () => { root.unmount(); host.remove(); };
  await act(async () => root.render(<form onSubmit={submit}><CredentialField label="비밀번호" secret value="Example! 123" /></form>));
  const input = host.querySelector('input')!; expect(input.type).toBe('text'); expect(input.value).toBe('Example! 123');
  await act(async () => (host.querySelector('[aria-label="비밀번호 숨기기"]') as HTMLButtonElement).click());
  expect(input.type).toBe('password');
  await act(async () => (host.querySelector('[aria-label="비밀번호 복사"]') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith('Example! 123'); expect(submit).not.toHaveBeenCalled();
  expect(host.querySelector('[role=status]')?.textContent).toBe('복사했습니다.');
});
it('falls back when clipboard access is unavailable, restores focus and reports failures', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  const button = document.createElement('button'); document.body.append(button); button.focus();
  const exec = vi.fn(() => true); Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
  await copyTextToClipboard('exact-value'); expect(exec).toHaveBeenCalledWith('copy');
  expect(document.activeElement).toBe(button); expect(document.querySelector('textarea')).toBeNull();
  exec.mockReturnValue(false); await expect(copyTextToClipboard('value')).rejects.toThrow('직접 복사'); button.remove();
});
