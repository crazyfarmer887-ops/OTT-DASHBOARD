# Screenshot guide and readable mailbox URLs

Spec: [gbuts-netflix-real-guide.md](../gbuts-netflix-real-guide.md)

- [x] Capture real blank PIN, empty inbox and refresh UI without private values.
- [x] Compose and visually inspect the instructional JPG; upload once and verify bytes/browser rendering.
- [x] Emit literal @ in new mailbox URLs; keep old encoded URLs usable.
- [x] Add authenticated IMAGE transport and durable, future-only delivery after confirmed credentials.
- [x] Verify uncertain-send recovery, no historical replay, opt-in scope and shared service regressions.
- [x] Commit/push, deploy source archive, activate sp1 opt-in and verify the running worker without a buyer test message.

Release `3ef2247` is active at `/home/ubuntu/releases/aio-dashboard-3ef2247`. Local and Linux validation:283 tests in18 suites pass; client build passes. TypeScript reports the same31 pre-existing diagnostics as clean9c0ef7b, with no new diagnostic. Scope is one account, sp1, activated2026-10-28T15:03:55Z. Authenticated API and worker lastSuccess are healthy.140 existing confirmed orders retain their assignments and direct-delivery records; post19022 remains disabled and general support remains inactive. There are no sp1 orders yet, so no live buyer IMAGE send is claimed. Runtime backup/activation/smoke receipts are private under `/home/ubuntu/.config/gbuts/netflix-guide-assets/release-3ef2247/`.
