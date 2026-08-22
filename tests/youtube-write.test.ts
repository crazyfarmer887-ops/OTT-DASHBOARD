import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildYouTubeListingTitle,
  buildYouTubeProductRequest,
  clampYouTubeRepeat,
  createYouTubeIdempotencyKey,
  normalizeYouTubeEndDate,
  getSeoulTomorrow,
  summarizeYouTubeRegistration,
  getYouTubePostRegistrationStep,
  appendYouTubeListingCode,
} from '../src/web/lib/youtube-write';
import { removeYouTubeListingCode } from '../src/lib/youtube-listing-code';

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
    listingCode: 'abc123',
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
      name: '유튜브 프리미엄 abc123',
      sellingGuide: '초대 안내',
    }),
  });
});

test('preview title and request name share trimmed edge handling while preserving internal spaces', () => {
  const name = '  유튜브!!  프리미엄  ';
  const listingCode = 'abc123';
  const previewTitle = buildYouTubeListingTitle(name, listingCode);
  const request = buildYouTubeProductRequest({
    familyGroupId: 'youtube-family-group:1',
    endDate: '2026-12-31',
    price: 4500,
    name,
    listingCode,
    sellingGuide: '초대 안내',
    idempotencyKey: 'yt-12345678',
  });
  const requestBody = JSON.parse(String(request.init.body)) as { name: string };

  assert.equal(previewTitle, '유튜브!!  프리미엄 abc123');
  assert.equal(requestBody.name, previewTitle);
});

test('appendYouTubeListingCode removes current code tokens across the title and appends exactly one normalized suffix', () => {
  assert.equal(appendYouTubeListingCode('유튜브 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('abc123 유튜브 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 ABC123 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('ABC123  유튜브\tabc123 프리미엄 AbC123', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 xabc123y 프리미엄', 'abc123'), '유튜브 xabc123y 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 프리미엄 old999', 'abc123'), '유튜브 프리미엄 old999 abc123');
});

test('appendYouTubeListingCode removes punctuation-delimited codes without leaving awkward punctuation', () => {
  assert.equal(appendYouTubeListingCode('ABC123, 유튜브 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 abc123, 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 (ABC123) 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 [abc123] 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 abc123. 프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브,abc123,프리미엄', 'abc123'), '유튜브,프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브.abc123.프리미엄', 'abc123'), '유튜브.프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브/abc123/프리미엄', 'abc123'), '유튜브/프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브-abc123-프리미엄', 'abc123'), '유튜브-프리미엄 abc123');
});

test('appendYouTubeListingCode preserves codes embedded in larger letter or number words', () => {
  assert.equal(appendYouTubeListingCode('유튜브 xabc123y 프리미엄', 'abc123'), '유튜브 xabc123y 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 xabc123 프리미엄', 'abc123'), '유튜브 xabc123 프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브 abc123y 프리미엄', 'abc123'), '유튜브 abc123y 프리미엄 abc123');
});

test('appendYouTubeListingCode safely matches listing codes containing regex metacharacters', () => {
  assert.equal(appendYouTubeListingCode('유튜브 (A.B+1) 프리미엄', 'a.b+1'), '유튜브 프리미엄 a.b+1');
});

test('removeYouTubeListingCode preserves the exact title when no standalone code exists', () => {
  assert.equal(removeYouTubeListingCode('유튜브!!  프리미엄', 'abc123'), '유튜브!!  프리미엄');
  assert.equal(removeYouTubeListingCode('  유튜브!!  프리미엄  ', ''), '  유튜브!!  프리미엄  ');
  assert.equal(removeYouTubeListingCode('xabc123y  xabc123 abc123y', 'abc123'), 'xabc123y  xabc123 abc123y');
  assert.equal(appendYouTubeListingCode('유튜브!!  프리미엄', 'abc123'), '유튜브!!  프리미엄 abc123');
});

test('appendYouTubeListingCode surgically cleans Unicode separators around a standalone code', () => {
  assert.equal(appendYouTubeListingCode('유튜브_abc123_프리미엄', 'abc123'), '유튜브_프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브—abc123—프리미엄', 'abc123'), '유튜브—프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브·abc123·프리미엄', 'abc123'), '유튜브·프리미엄 abc123');
  assert.equal(appendYouTubeListingCode('유튜브（abc123）프리미엄', 'abc123'), '유튜브 프리미엄 abc123');
});

test('write page previews the generated YouTube title but persists only the raw title preset', () => {
  const source = readFileSync(new URL('../src/web/pages/write.tsx', import.meta.url), 'utf8');
  assert.match(source, /const youtubeFinalTitle = selectedYoutubeGroup[\s\S]*buildYouTubeListingTitle\(title, selectedYoutubeGroup\.listingCode\)/);
  assert.match(source, /buildYouTubeProductRequest\(\{[\s\S]*name: title,[\s\S]*listingCode: selectedYoutubeGroup\.listingCode/);
  assert.match(source, /최종 등록 제목:\s*<strong>\{youtubeFinalTitle\}<\/strong>/);
  assert.match(source, /\[service\]: \{ title: title\.trim\(\), description: description\.trim\(\), updatedAt:/);
  assert.doesNotMatch(source, /\[service\]: \{ title: youtubeFinalTitle/);
  assert.doesNotMatch(source, /selectedYoutubeGroup\?\.managerEmail|selectedYoutubeGroup\.managerEmail\b/);
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
