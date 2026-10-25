# Netflix remaining-place rank renewal

## 1. Extend the existing durable renewal flow
Blocked by: None.
Status: complete.

- [x] Netflix rank monitoring uses its own category and keeps other categories healthy on lookup failure.
- [x] Final-roster capacity transfer, historical profile leases, lost-response recovery and live merchant copy survive reposts.
- [x] Existing Disney behavior and safe-mode gates remain compatible.

## 2. Enable current and future Netflix sales
Blocked by: 1.
Status: complete.

- [x] Verified new Netflix publication automatically enables rank threshold five; existing older chains are not migrated.
- [x] Explicit current-listing activation and status preserve per-service identity and actual expiry.
- [x] Tests/review/commit/push/deployment pass, then activate current 190/day chain and update existing quiet heartbeat.
- [x] Verify actual settings, progress and existing buyer delivery receipts without synthetic chats.

Local verification: 151 focused tests across eight suites and the client build pass. Whole Vitest run: 1,340 pass, 153 fail across 26 files, matching the documented pre-existing failure count; an exact cef4f9f baseline comparison confirmed identical normalized failure signatures (1,328 baseline passes). Worker type checking diagnostics are byte-for-byte identical to that same baseline; none name the new renewal modules. Production has not yet changed.

Review: Spec found no P1/P2. Standards identified expired Netflix native-field synchronization requiring a now-unpaid account and stopping the poller. Reproduced at the provider/store seam, then excluded expired history from native credential synchronization. Healthy Disney processing continues while live Netflix still requires valid current credentials. Regression verification pending.

Read-only production preflight reproduced unresolved legacy Netflix placeholder rows. Added scoped seller-owned delivery-link/ID resolution and positive-expiry filtering; no cache/access mutation. Live inventory then verified the target is paid, has five total places, zero foreign users/recruitment, and November23 expiry. Both review axes found single-message multiple IDs were initially collapsed by the existing parser; added a failing multiline/same-line regression and collect all emails in an explicit seller delivery before ambiguity rejection.

## Final review — Standards

No remaining P1/P2 after fixing expired native-field synchronization and single-message multi-account ambiguity. Re-review confirmed both fixes and the non-email username guard.

## Final review — Spec

No remaining findings after the ambiguity refinement. Current and future newly managed Netflix publications opt in; older chains are unchanged. Capacity, leases, delivery receipts, real expiry, live copy and unknown-CREATE recovery are preserved.

## Production — October25, 12:43 KST

Deployed committed/pushed source `95ed512` to `/home/ubuntu/releases/aio-dashboard-95ed512`. Exact archive checksum and unchanged dependency lock verified. Linux verification: 204 focused tests across10 suites and client build pass. Local whole-suite comparison against cef4f9f has no new normalized failure signatures; worker type diagnostics match the baseline. Private preflight verified current paid account, five total places, zero GrayTag users/recruitment, resolved current credentials and November23 expiry. No production source edits were used.

Preserved every existing service environment value, original configuration/data paths, and all critical fields of117 previously confirmed buyer orders. Authenticated health is healthy; no automatic safety modes were changed. Explicitly enabled only `netflix-20261025-primestore-190-v1` (post18210) through the existing authenticated API: capacity5, rank trigger, threshold5. Native monitoring recorded rank2 and advancing next-check timestamps, no error/pending publication. Actual provider had two buyers and three unfilled places; its190/day, November23 expiry and nickname/password-only description remain unchanged. A listing remains high in the list, so no artificial repost was forced.

Updated existing heartbeat `automation` in place to monitor Disney plus enabled current/future Netflix, preserving hourly cadence and quiet normal operation. Added read-only Spotify completion-log monitoring to surface a future persistent processing stall; it never restarts the service or sends buyer messages by itself. The native server owns minute-level rank monitoring. Private activation/rollback and buyer-preservation evidence is under shared data `backups/netflix-rank-95ed512-20261025T034304Z/`.
