import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildYouTubeProductRequest,
  clampYouTubeRepeat,
  createYouTubeIdempotencyKey,
  normalizeYouTubeEndDate,
  getSeoulTomorrow,
  summarizeYouTubeRegistration,
  getYouTubePostRegistrationStep,
} from '../src/web/lib/youtube-write';

test('clampYouTubeRepeat limits registration count to available seats and twenty', () => {
  assert.equal(clampYouTubeRepeat(7, 3), 3);
  assert.equal(clampYouTubeRepeat(99, 50), 20);
  assert.equal(clampYouTubeRepeat(0, 4), 1);
  assert.equal(clampYouTubeRepeat(2, 0), 0);
});

test('normalizeYouTubeEndDate defaults and caps the date at subscription expiry', () => {
  assert.equal(normalizeYouTubeEndDate('', '2026-12-31'), '2026-12-31');
  assert.equal(normalizeYouTubeEndDate('2027-01-01', '2026-12-31'), '2026-12-31');
  assert.equal(normalizeYouTubeEndDate('2026-11-01', '2026-12-31'), '2026-11-01');
  assert.equal(normalizeYouTubeEndDate('', null), '');
});

test('createYouTubeIdempotencyKey uses UUID and provides an ASCII fallback', () => {
  assert.equal(createYouTubeIdempotencyKey({ randomUUID: () => '12345678-abcd-4abc-8abc-123456789012' }), 'yt-12345678-abcd-4abc-8abc-123456789012');
  const fallback = createYouTubeIdempotencyKey(undefined, 1234567890, () => 0.25);
  assert.match(fallback, /^[A-Za-z0-9._~:+-]{8,128}$/);
});

test('buildYouTubeProductRequest emits the exact safe endpoint, headers and body', () => {
  const request = buildYouTubeProductRequest({
    familyGroupId: 'youtube-family-group:1',
    endDate: '2026-12-31',
    price: 4500.9,
    name: '유튜브 프리미엄',
    sellingGuide: '초대 안내',
    idempotencyKey: 'yt-12345678',
  });
  assert.equal(request.url, '/api/youtube/products');
  assert.deepEqual(request.init, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-audit-reason': 'youtube-invitation-product-registration',
      'Idempotency-Key': 'yt-12345678',
    },
    body: JSON.stringify({
      familyGroupId: 'youtube-family-group:1',
      endDate: '20261231T2359',
      price: 4500,
      name: '유튜브 프리미엄',
      sellingGuide: '초대 안내',
    }),
  });
});

test('getSeoulTomorrow uses the Asia/Seoul calendar day with an injected clock', () => {
  assert.equal(getSeoulTomorrow(() => new Date('2026-08-14T14:59:59.000Z')), '2026-08-15');
  assert.equal(getSeoulTomorrow(() => new Date('2026-08-14T15:00:00.000Z')), '2026-08-16');
  assert.equal(getSeoulTomorrow(() => new Date('2026-12-31T15:30:00.000Z')), '2027-01-02');
});

test('YouTube completion summary keeps success, safely stopped slots, and uncertainty distinct', () => {
  assert.deepEqual(summarizeYouTubeRegistration([
    { index: 1, status: 'done' },
    { index: 2, status: 'error', error: '등록 결과가 불확실합니다. 자동 재시도 금지' },
    { index: 3, status: 'error', error: '안전을 위해 후속 등록을 중단했어요.' },
  ]), { successCount: 1, uncertainCount: 1, safelyStoppedCount: 1, failedCount: 0, requestedCount: 3 });
});

test('YouTube never enters the credential-delivery step after registration', () => {
  assert.equal(getYouTubePostRegistrationStep(2), 'done');
  assert.equal(getYouTubePostRegistrationStep(0), 'done');
});
