# Spotify listing registration tickets

- [x] Add the invitation listing client, durable request journal and source template loading.
- [x] Add publication and read-only reconciliation APIs with duplicate prevention.
- [x] Add the Spotify sales form and dashboard entry.
- [x] Extend existing Spotify automation to verified new listing IDs.
- [x] Run regression checks/build, review, commit/push, deploy and smoke-test.

2026-10-18 verification: 107 tests passed across 11 suites; production client build passed. Reviewed template fidelity, request journaling, read-only reconciliation, duplicate prevention, buyer isolation and React form behavior. Runtime commit `7b7b80c` is deployed at `/home/ubuntu/releases/aio-dashboard-7b7b80c`; service active. Authenticated template API returned 200 in 0.11s, exactly matching source title/body/both notices; unauthenticated read returned 403 and invalid submission 400. Headless production browser verified dashboard navigation, original defaults, enabled registration, desktop/mobile layout and zero page errors. No synthetic sale or buyer message was created. Existing automatic Spotify flags remain enabled. Broader TypeScript checks retain existing diagnostics outside the added modules.

## Deletion follow-up

- [x] Observe vendor recruitment closure contract; do not use destructive sharing termination.
- [x] Add confirmed close-and-hide action, retain buyer monitor IDs and suppress deleted entries in sales overview.
- [x] Verify confirmation/cancel, successful and lost closure responses, repeated deletion, uncertain registrations, buyer-monitor retention and hidden overview (80 tests across 5 focused suites; build passed).
- [x] Commit/push, deploy and verify the actual registered listing's delete control without deleting it during the smoke check.

Runtime `14c9184` deployed on 2026-10-18; service active. Production desktop/mobile browser confirms the existing listing has an enabled Delete button and no page errors or horizontal overflow. Authenticated DELETE for a nonexistent record returns 404; unauthenticated DELETE returns 403. The real listing remains visible and unchanged (one record), and automatic processing is enabled. No actual recruitment closure or sharing termination was executed during smoke verification.


## Buyer automation incident — 2026-10-24

- [x] Read production membership, chat metadata, Notion and message receipts. Found one current complete credential submission without an order-linked row or receipt.
- [x] Reproduce three failures before changing code: complete-pair abstention frozen for 24 hours, welcome blocked by Notion, delivery callback skipped after import failure.
- [x] Decouple welcome/import/delivery and retry complete-pair model abstentions in one minute. Preserve uncertain-send and vendor checkbox safeguards.
- [x] Verify relevant extraction, multi-listing isolation, guides, acknowledgments, vendor completion, duplicate-send and refund behavior: 112 tests passed across eight suites; client build and whitespace checks passed.
- [x] Commit/push, deploy committed source and verify actual missed order recovery and continued polling.

Production verification: committed release `bd074c2` is active at `/home/ubuntu/releases/aio-dashboard-bd074c2`; local health returned 200 and the existing environment/stores were preserved. The same eight suites passed on Linux (112 tests). The incident order now has exactly one Notion row, with ID/password equal to buyer-authored chat. At the verification read the vendor had checked Invited, with Registered false. The worker sent the existing invitation confirmation once at 23:43:51 KST; the next poll confirmed the saved message in its journal at 23:44:13 KST and attempted zero additional deliveries. Two completed polls covered all four retained listing IDs without errors. No synthetic buyer or listing was created. The live observation proves completion delivery and duplicate suppression; credential creation was not attributed to this worker because the row already existed when its first completed import ran. Welcome and credential import failure/retry paths were verified with deterministic regressions. Existing broad worker typing diagnostics remain outside this change, including pre-existing WebSocket event-property diagnostics.
