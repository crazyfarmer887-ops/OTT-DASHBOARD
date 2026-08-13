import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const verifierSource = readFileSync(new URL('../src/renewal/graytag-registration-verifier.ts', import.meta.url), 'utf8');

test('renewal API is admin protected, safe-mode protected, and live gated', () => {
  assert.match(apiSource, /ADMIN_REQUIRED_GET_PREFIXES[\s\S]*['"]\/renewal-automation['"]/);
  assert.match(apiSource, /['"]\/renewal-automation\/tick['"]/);
  assert.match(apiSource, /renewal-automation\\\/jobs/);
  assert.match(apiSource, /RENEWAL_AUTOMATION_LIVE_DISABLED/);
  assert.match(apiSource, /requestedLive && !flags\.live/);
  assert.match(apiSource, /dryRun: requestedLive \? false : true/);
});

test('renewal extension registration POST uses the single-attempt transport path', () => {
  const registrationTransport = apiSource.match(/async function registerGraytagExtensionProduct[\s\S]*?\n}/)?.[0] || '';
  assert.match(registrationTransport, /rateLimitedFetch\([\s\S]*?\},\s*true\s*\)/);
});

test('runtime wires read-only candidates, deterministic multipart registration, chat and durable jobs', () => {
  assert.match(apiSource, /findNearExpirationDeals/);
  assert.match(apiSource, /buildMultipartJsonBody\(model\)/);
  assert.match(apiSource, /['"]Content-Type['"]:\s*multipart\.contentType/);
  assert.match(apiSource, /body:\s*multipart\.body/);
  assert.doesNotMatch(apiSource, /new FormData\(\)/);
  assert.match(apiSource, /\/ws\/lender\/registerProduct/);
  assert.match(apiSource, /sendGraytagChatMessage\(input\)/);
  assert.match(apiSource, /JsonRenewalJobStore/);
  assert.match(apiSource, /buildRegistrationEvidenceSnapshot/);
  assert.match(apiSource, /verifyRegistration:\s*fetchGraytagRenewalRegistrationEvidence/);
  assert.match(apiSource, /dealStatus === ['"]OnSale['"]/);
  assert.match(verifierSource, /priceType/);
  assert.match(apiSource, /findBeforeUsingLenderDeals/);
  assert.match(apiSource, /strictLenderDeals/);
  assert.match(apiSource, /authoritative:\s*false/);
  assert.doesNotMatch(apiSource.match(/async function fetchGraytagRenewalRegistrationEvidence[\s\S]*?\n}/)?.[0] || '', /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
});

test('manual renewal management routes expose sanitized preview, selected batch and audited review actions', () => {
  assert.match(apiSource, /get\(['"]\/renewal-automation\/candidates['"]/);
  assert.match(apiSource, /buildRenewalPreviewRows/);
  assert.match(apiSource, /post\(['"]\/renewal-automation\/batch['"]/);
  assert.match(apiSource, /idempotencyKeys/);
  assert.match(apiSource, /runSelectedRenewalBatch/);
  assert.match(apiSource, /get\(['"]\/renewal-automation\/reviews['"]/);
  assert.match(apiSource, /post\(['"]\/renewal-automation\/reviews\/action['"]/);
  assert.match(apiSource, /store\.applyReviewAction\(/);
  assert.doesNotMatch(apiSource, /store\.put\(applyRenewalReviewAction/);
  assert.match(apiSource, /authenticatedAdminActor\(c\)/);
  assert.match(apiSource, /actor,\s*at: transitionAt/);
  assert.doesNotMatch(apiSource, /applyReviewAction[\s\S]{0,200}actor: ['"]admin['"]/);
  assert.match(apiSource, /mark_issued/);
  assert.match(apiSource, /수동 지급 완료/);
  assert.match(apiSource, /renewal\.review/);
});

test('all renewal mutations are safe-mode protected and browser GET auth includes renewal prefix', () => {
  const adminAuth = readFileSync(new URL('../src/web/lib/admin-auth.ts', import.meta.url), 'utf8');
  assert.match(apiSource, /['"]\/renewal-automation\/batch['"]/);
  assert.match(apiSource, /['"]\/renewal-automation\/reviews\/action['"]/);
  assert.match(apiSource, /reconcile-registration/);
  assert.match(adminAuth, /['"]\/api\/renewal-automation['"]/);
});

test('manual registration reconciliation is admin/safe-mode guarded, actor audited, read-only, and returns a sanitized DTO', () => {
  assert.match(apiSource, /post\(['"]\/renewal-automation\/jobs\/:id\/reconcile-registration['"]/);
  assert.match(apiSource, /reconcileRenewalRegistration\(/);
  assert.match(apiSource, /authenticatedAdminActor\(c\)/);
  assert.match(apiSource, /renewal\.reconcile-registration/);
  assert.match(apiSource, /renewalReviewDto\(job\)/);
  assert.doesNotMatch(apiSource, /reconcile-registration[\s\S]{0,800}registerGraytagExtensionProduct/);
});

test('safe registration retry route is admin/live/safe-mode guarded, actor audited, and returns a sanitized DTO', () => {
  assert.match(apiSource, /post\(['"]\/renewal-automation\/jobs\/:id\/retry-registration['"]/);
  assert.match(apiSource, /retryRenewalRegistration\(/);
  assert.match(apiSource, /renewal\.retry-registration/);
  assert.match(apiSource, /authenticatedAdminActor\(c\)/);
  assert.match(apiSource, /renewalReviewDto\(job\)/);
  assert.match(apiSource, /retry-registration/);
  assert.match(apiSource, /RENEWAL_AUTOMATION_LIVE_DISABLED/);
});

test('retry-message, retry-registration and reconcile-registration route regexes are safe-mode protected', () => {
  assert.match(apiSource, /retry-message/);
  assert.match(apiSource, /retry-registration/);
  assert.match(apiSource, /reconcile-registration/);
});

test('daemon is started but remains env-gated', () => {
  assert.match(serverSource, /startRenewalAutomationDaemon\(port\)/);
  const daemon = readFileSync(new URL('../src/scheduler/renewal-automation-daemon.ts', import.meta.url), 'utf8');
  assert.match(daemon, /RENEWAL_AUTOMATION_ENABLED/);
  assert.match(daemon, /RENEWAL_AUTOMATION_LIVE/);
  assert.match(daemon, /Math\.max\(5 \* 60 \* 1000/);
});
