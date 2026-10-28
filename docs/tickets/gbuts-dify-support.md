# GButs Dify support implementation

- [x] Local policy, redacted inference context, state machine and tests.
- [x] Dify workflow, dedicated resource-limited deployment and runtime provider bridge.
- [x] Private real-inquiry shadow replay and validation report.
- [x] Telegram handoff and durable verified chat delivery.
- [x] Commit/push, checksum deployment, runtime smoke; promote only validated low-risk responses.
- [x] Record limits, no paid activation, Kilo quota cooldown and verified-result caching.

2026-10-28: source8a11679 deployed; local and Linux65focused tests pass.48case replay:24fixtures+24real,31rules-first handoff/delegation,17Dify cached results,17/17safe matches,0unsafe/invalid,0new provider attempts. Existing verified model runs supplied the cache; this is not48fresh AI requests. Fresh worker scan152rooms/errors0/unavailable7. Gate accepted; autoSince2026-10-28T05:55:45.759Z, historical replay false. Seven platform-rejected rooms remain excluded and trigger the existing bot's operational alert. No synthetic customer SEND. Existing youtube-invitation-poller.ts:131 type diagnostic remains outside this change.

## V2

- [ ] Official-source diagnostic catalog and compact actionable step templates.
- [ ] Multi-turn issue/device memory, completed-step suppression and useful unknown-error clarification.
- [ ] Dify anonymous diagnosis/stage allowlist and validated deterministic safety constraints.
- [ ] Meaningful regression/hostile/multi-turn tests and private shadow replay.
- [ ] Committed deployment, V2 proof, promotion and runtime smoke without synthetic sends.
