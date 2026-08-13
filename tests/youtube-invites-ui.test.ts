import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { actionForYouTubeInvitationStatus, filterYouTubeInvitations } from '../src/web/pages/youtube-invites';
import { createLatestRequestController } from '../src/web/lib/latest-request';
import { YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE } from '../src/lib/youtube-invite-email';

const pageSource = readFileSync(new URL('../src/web/pages/youtube-invites.tsx', import.meta.url), 'utf8');

const invitations = [
  { id: 'one', status: 'waiting_for_buyer_email', familyGroupId: 'family-a' },
  { id: 'two', status: 'active', familyGroupId: 'family-b' },
  { id: 'three', status: 'failed', familyGroupId: 'family-a' },
] as any;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('YouTube invitation operations helpers', () => {
  test.each([
    ['waiting_for_buyer_email', 'email-candidate'],
    ['email_candidate_found', 'confirm-email'],
    ['email_confirmed', 'mark-invite-sent'],
    ['invite_sent', 'finish-delivery'],
    ['delivery_completion_pending', 'reconcile'],
    ['delivered_waiting_inspection', 'reconcile'],
    ['active', 'reconcile'],
    ['failed', 'resume'],
    ['ended', null],
    ['waiting_for_group_assignment', null],
  ])('maps %s to the only safe operator action', (status, action) => {
    expect(actionForYouTubeInvitationStatus(status as any)).toBe(action);
  });

  test('combines status and family filters without reordering rows', () => {
    expect(filterYouTubeInvitations(invitations, 'all', 'family-a').map((row) => row.id)).toEqual(['one', 'three']);
    expect(filterYouTubeInvitations(invitations, 'active', 'all').map((row) => row.id)).toEqual(['two']);
  });
});

describe('latest refresh request controller', () => {
  test('only the latest response can publish data or finish refreshing', async () => {
    const slowA = deferred<string>();
    const fastB = deferred<string>();
    const events: string[] = [];
    const controller = createLatestRequestController<string>({
      load: vi.fn()
        .mockImplementationOnce(() => slowA.promise)
        .mockImplementationOnce(() => fastB.promise),
      onStart: () => events.push('start'),
      onSuccess: (value) => events.push(`success:${value}`),
      onError: () => events.push('error'),
      onFinish: () => events.push('finish'),
    });

    const requestA = controller.run();
    const requestB = controller.run();
    fastB.resolve('B');
    await requestB;
    slowA.resolve('A');
    await requestA;

    expect(events).toEqual(['start', 'start', 'success:B', 'finish']);
  });

  test('aborts superseded work and publishes neither error nor finish after disposal', async () => {
    const pending = deferred<string>();
    let observedSignal: AbortSignal | undefined;
    const events: string[] = [];
    const controller = createLatestRequestController<string>({
      load: (signal) => { observedSignal = signal; return pending.promise; },
      onStart: () => events.push('start'),
      onSuccess: () => events.push('success'),
      onError: () => events.push('error'),
      onFinish: () => events.push('finish'),
    });

    const request = controller.run();
    controller.dispose();
    expect(observedSignal?.aborted).toBe(true);
    pending.reject(new Error('late failure'));
    await request;

    expect(events).toEqual(['start']);
  });
});

describe('YouTube invitation operations UI contracts', () => {
  test('uses the canonical buyer email request message instead of a page-local duplicate', () => {
    expect(YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE).toContain('Google 이메일 주소');
    expect(pageSource).toMatch(/import \{ YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE \} from ['"]\.\.\/\.\.\/lib\/youtube-invite-email['"]/);
    expect(pageSource).not.toMatch(/(?:export\s+)?const YOUTUBE_EMAIL_REQUEST_MESSAGE\s*=/);
  });

  test('does not render an empty result alongside an initial load error', () => {
    expect(pageSource).toMatch(/!loading\s*&&\s*!error\s*&&\s*filtered\.length === 0/);
  });

  test('retains a confirmed full email only in tab state and clears it only after invite-sent success', () => {
    expect(pageSource).toMatch(/useState<Record<string, string>>\(\{\}\)/);
    expect(pageSource).toMatch(/onEmailConfirmed/);
    expect(pageSource).toMatch(/onInviteSent/);
    expect(pageSource).toContain('수동 Google 초대 대상 이메일');
    expect(pageSource).toContain('확인 요청에 실패했습니다. 이메일을 수정하거나 그대로 다시 시도해 주세요.');
    expect(pageSource).not.toMatch(/localStorage|sessionStorage|console\.(?:log|warn|error)/);
  });

  test('keeps warning, confirmation, disabled, and mobile overflow safeguards explicit', () => {
    expect(pageSource).toMatch(/response\.status === 202 \|\| response\.status === 502/);
    expect(pageSource).toContain('자동 재시도하지 않았습니다');
    expect(pageSource).toContain('Google 가족 초대를 수동으로 보낸 것이 맞습니까?');
    expect(pageSource).toMatch(/disabled=\{disabled \|\| !email\.trim\(\)\}/);
    expect(pageSource).toContain("overflowX: 'hidden'");
    expect(pageSource).toContain("overflowWrap: 'anywhere'");
  });
});
