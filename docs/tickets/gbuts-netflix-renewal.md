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

Local verification: 151 focused tests across eight suites and the client build pass. Whole Vitest run: 1,340 pass, 153 fail across 26 files, matching the documented pre-existing failure count; an exact current-base comparison is pending. Worker type checking reports existing diagnostics in unrelated sections; none name the new renewal modules. Production has not yet changed.
