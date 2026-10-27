# Invitation repost preflight: encrypted empty credentials

2026-10-27. The dedicated YouTube rank worker repeatedly stopped before closure with the generic result/buyer verification error. A read-only probe of the deployed worker narrowed the failure to `privateFields`: both seller credential fields decrypted successfully to empty strings. The decoder's existing empty-string fallback made a valid invitation value indistinguishable from a decryption failure.

`tryDecodeGbutsSubscriptionCredential` now returns `null` for failure and preserves successfully decrypted empty strings. The original decoder retains its existing string-returning behavior for other callers. Rank preflight and result adoption use the explicit failure result; corrupt ciphertext still blocks before closure. No journal migration, enrollment, sale terms, buyer delivery, or Google invitation changes are required.

Regression: the real renewal engine receives encrypted empty fields on both source and created result, publishes only four remaining seats, adopts one result, and retains the paid buyer on the source post. A second test verifies corrupt ciphertext causes no CLOSE/CREATE. The empty-field regression failed before the fix and passes afterward.

Validation before deployment: 484 related tests across 32 suites passed; frontend build and diff whitespace checks passed. The focused backend type check still reports the pre-existing unrelated `youtube-invitation-poller.ts:131` unknown-to-string error.

Operational verification must use an isolated candidate release with temporary test paths, then a read-only live preflight with mutations blocked. Deploy only the AIO service, preserve existing policy/journal files and independent Google/NBA services, and confirm the scheduler's exact existing chain recovers without replaying any uncertain CREATE.

## Deployment result

- Code release `82fb0a9`, archived from the pushed commit and SHA-256 verified, deployed to `/home/ubuntu/releases/aio-dashboard-82fb0a9`. Existing dependency lock and configuration were preserved. Private journal and service-override backups are retained for rollback; no production source was edited.
- The isolated Linux candidate passed the same 484 tests and build. The original live preflight probe changed from a decode error to success with zero remote mutations and in-memory-only journal writes.
- At 2026-10-27T09:40:27.733Z the existing chain `18756 → 18858 → 18864` recovered to `18877` through the normal worker and lookup adoption. One authenticated run was requested when due; no CREATE was manually replayed.
- Read-only seller and public-ranking checks confirmed: old post closed, new post on sale at rank 1, capacity 3 after two paid buyers, unchanged public terms (190/day, end 2026-11-26 23:59:59), and both buyers still bound to the old post. No pending transaction or last error remains.
- All 17 legacy OTT policies remained enabled with no errors/pending. Future discovery remained enabled, safe mode off, cutoff 18858, watermark advanced to 18877, and no duplicate generic enrollment. Spotify sync continued; independent Google/NBA service configuration was not changed. The separate Google session issue is outside this repost fix.
