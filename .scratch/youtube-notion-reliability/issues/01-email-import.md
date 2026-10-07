# 01 — Stop AI abstentions hiding paid buyer emails

Spec: ../spec.md. Status: implementation verified locally, release pending.

- [x] Audit all six pending orders against buyer chat, Notion and delivery journal.
- [x] Reproduce exact plain-email rejection and 24-hour negative-cache failure in tests before fixes.
- [x] Bypass the model only for a unique bare latest buyer address accepted by the existing deterministic parser.
- [x] Retry email abstentions after one minute; preserve credential cache behavior.
- [x] Run the four relevant suites: 67 passing tests.
- [ ] Typecheck/build, full suite once, two-axis review.
- [ ] Commit/push and deploy the committed release.
- [ ] Verify both missing rows and slot summary in actual Notion; report all six order outcomes and attempted-delivery limits.
