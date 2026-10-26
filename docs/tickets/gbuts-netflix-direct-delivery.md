# Netflix direct private credentials

Spec: docs/gbuts-netflix-direct-delivery.md
Status: in progress.

- [x] Verify and privately fulfill the current inquiry buyer, then reply to their comment.
- [x] Replace future Netflix access-link guides with password-only private instructions and automatic ID/PW delivery.
- [x] Preserve legacy confirmation, profile leases, paid/refund checks, durable uncertain-send recovery and other service behavior.
- [ ] Focused regression tests, type/build checks, two-axis review, commit/push and isolated application deployment.
- [ ] Verify live delivery receipts and new runtime without disclosing credentials or bulk re-sending historical orders.


Current buyer recovery: live membership was APPLY/REFUND_REJECTED (not refunded), correct order/user/profile1, and the private room contained only the verified buyer and seller. The current resolver validated account/profile binding. Two private message parts containing direct ID/PW and password-only instructions were confirmed saved; no credential or URL was printed or stored in Git. A hash-only receipt with the exact buyer/order mapping is retained under shared data/backups, outside Git. One seller reply at13:00KST asks the buyer to check1:1chat; visible confirmation screenshot is in the chat workspace artifacts/netflix-direct-20261026/comment-confirmed.png.

Verification before deployment:196focused tests in12suites pass; client build and whitespace check pass. Full suite1351pass/153fail across the same existing unrelated files. Targeted TypeScript diagnostics are identical to a clean2ac066d archive: one pre-existing youtube-invitation-poller.ts:131 error. Standards/Spec reviews report0remainingfindings. No production source edit; committed deployment and smoke validation follow.
