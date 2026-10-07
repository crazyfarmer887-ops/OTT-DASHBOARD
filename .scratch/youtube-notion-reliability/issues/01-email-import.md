# 01 — Stop AI abstentions hiding paid buyer emails

Spec: ../spec.md. Status: deployed and verified (7a74b85, 2026-10-07).

- [x] Audit all six pending orders against buyer chat, Notion and delivery journal.
- [x] Reproduce exact plain-email rejection and 24-hour negative-cache failure in tests before fixes.
- [x] Bypass the model only for a unique bare latest buyer address accepted by the existing deterministic parser.
- [x] Retry email abstentions after one minute; preserve credential cache behavior.
- [x] Run the four relevant suites: 67 passing tests.
- [x] Typecheck/build, full suite once, two-axis review.
- [x] Commit/push and deploy the committed release.
- [x] Verify both missing rows and slot summary in actual Notion; report all six order outcomes and attempted-delivery limits.

Final focused verification: 72 passing tests. D5BI repaired through the locked sync in fb9ca87; the final 7a74b85 worker itself imported D5BP. Fresh page reads verify unique order-bound rows, correct buyer emails, Invited=false and no cancellation flags. Actual summary block reads `Available slots: 8  |  Current slots: 77/85`. Other four orders retain the audited outcomes; both old attempted deliveries remain Delivering and are not replayed.
