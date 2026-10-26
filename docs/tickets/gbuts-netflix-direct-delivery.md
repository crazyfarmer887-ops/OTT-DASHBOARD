# Netflix direct private credentials

Spec: docs/gbuts-netflix-direct-delivery.md
Status: complete.

- [x] Verify and privately fulfill the current inquiry buyer, then reply to their comment.
- [x] Replace future Netflix access-link guides with password-only private instructions and automatic ID/PW delivery.
- [x] Preserve legacy confirmation, profile leases, paid/refund checks, durable uncertain-send recovery and other service behavior.
- [x] Focused regression tests, type/build checks, two-axis review, commit/push and isolated application deployment.
- [x] Verify live delivery receipts and new runtime without disclosing credentials or bulk re-sending historical orders.


Current buyer recovery: live membership was APPLY/REFUND_REJECTED (not refunded), correct order/user/profile1, and the private room contained only the verified buyer and seller. The current resolver validated account/profile binding. Two private message parts containing direct ID/PW and password-only instructions were confirmed saved; no credential or URL was printed or stored in Git. A hash-only receipt with the exact buyer/order mapping is retained under shared data/backups, outside Git. One seller reply at13:00KST asks the buyer to check1:1chat; visible confirmation screenshot is in the chat workspace artifacts/netflix-direct-20261026/comment-confirmed.png.

Verification before deployment:196focused tests in12suites pass; client build and whitespace check pass. Full suite1351pass/153fail across the same existing unrelated files. Targeted TypeScript diagnostics are identical to a clean2ac066d archive: one pre-existing youtube-invitation-poller.ts:131 error. Standards/Spec reviews report0remainingfindings. No production source edit; committed deployment and smoke validation follow.


## Production — October26 KST

Pushed commitf85cc32 is deployed at /home/ubuntu/releases/aio-dashboard-f85cc32. Source archive SHA256987029fe181da9b0b4ad819fd2de9856d40fbe2c68330cdfa5751a7c6d4fb011 matched. Server dependencies matched the prior lockfile; Linux196focused tests and client build passed before activation. A final systemd drop-in changes only WorkingDirectory/ExecStart; existing environment files, settings and data paths remain unchanged. The service restart was part of this user-requested deployment, not an autonomous heartbeat repair.

Authenticated post-deploy health succeeded: automatic delivery enabled, safeModefalse,16renewal policies. Private comparisons found0assignment changes across131previously confirmed orders and0renewal configuration changes. The new guide is link-free. Both scoped recovery message parts remain confirmed exactly once, with0duplicates, and the recovered historical buyer was not automatically migrated. The normal sync loop advanced lastSuccess to2026-10-26T04:14:52.847Z with no error. No synthetic order, buyer prompt or extra credential message was used for the deployment smoke check.

Private pre-deploy inventory backup is under shared data/backups/netflix-direct-f85cc32. The independent NBA monitor release and timer were not changed. Existing unrelated untracked docs/research content remains untouched.
