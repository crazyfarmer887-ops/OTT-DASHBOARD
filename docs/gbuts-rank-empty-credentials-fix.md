# Invitation repost preflight: encrypted empty credentials

2026-10-27. The dedicated YouTube rank worker repeatedly stopped before closure with the generic result/buyer verification error. A read-only probe of the deployed worker narrowed the failure to `privateFields`: both seller credential fields decrypted successfully to empty strings. The decoder's existing empty-string fallback made a valid invitation value indistinguishable from a decryption failure.

`tryDecodeGbutsSubscriptionCredential` now returns `null` for failure and preserves successfully decrypted empty strings. The original decoder retains its existing string-returning behavior for other callers. Rank preflight and result adoption use the explicit failure result; corrupt ciphertext still blocks before closure. No journal migration, enrollment, sale terms, buyer delivery, or Google invitation changes are required.

Regression: the real renewal engine receives encrypted empty fields on both source and created result, publishes only four remaining seats, adopts one result, and retains the paid buyer on the source post. A second test verifies corrupt ciphertext causes no CLOSE/CREATE. The empty-field regression failed before the fix and passes afterward.

Validation before deployment: 484 related tests across 32 suites passed; frontend build and diff whitespace checks passed. The focused backend type check still reports the pre-existing unrelated `youtube-invitation-poller.ts:131` unknown-to-string error.

Operational verification must use an isolated candidate release with temporary test paths, then a read-only live preflight with mutations blocked. Deploy only the AIO service, preserve existing policy/journal files and independent Google/NBA services, and confirm the scheduler's exact existing chain recovers without replaying any uncertain CREATE.
