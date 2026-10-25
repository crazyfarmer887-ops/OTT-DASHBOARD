# Netflix remaining-place rank renewal

## 1. Extend the existing durable renewal flow
Blocked by: None.
Status: in-progress.

- [x] Netflix rank monitoring uses its own category and keeps other categories healthy on lookup failure.
- [x] Final-roster capacity transfer, historical profile leases, lost-response recovery and live merchant copy survive reposts.
- [x] Existing Disney behavior and safe-mode gates remain compatible.

## 2. Enable current and future Netflix sales
Blocked by: 1.
Status: ready-for-agent.

- [x] Verified new Netflix publication automatically enables rank threshold five; existing older chains are not migrated.
- [x] Explicit current-listing activation and status preserve per-service identity and actual expiry.
- [ ] Tests/review/commit/push/deployment pass, then activate current 190/day chain and update existing quiet heartbeat.
- [ ] Verify actual settings, progress and existing buyer delivery receipts without synthetic chats.

Local verification: 151 focused tests across eight suites and the client build pass. Whole Vitest run: 1,340 pass, 153 fail across 26 files, matching the documented pre-existing failure count; an exact cef4f9f baseline comparison confirmed identical normalized failure signatures (1,328 baseline passes). Worker type checking diagnostics are byte-for-byte identical to that same baseline; none name the new renewal modules. Production has not yet changed.

Review: Spec found no P1/P2. Standards identified expired Netflix native-field synchronization requiring a now-unpaid account and stopping the poller. Reproduced at the provider/store seam, then excluded expired history from native credential synchronization. Healthy Disney processing continues while live Netflix still requires valid current credentials. Regression verification pending.

Read-only production preflight reproduced unresolved legacy Netflix placeholder rows. Added scoped seller-owned delivery-link/ID resolution and positive-expiry filtering; no cache/access mutation. Live inventory then verified the target is paid, has five total places, zero foreign users/recruitment, and November23 expiry. Both review axes found single-message multiple IDs were initially collapsed by the existing parser; added a failing multiline/same-line regression and collect all emails in an explicit seller delivery before ambiguity rejection.
