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
