# Linkid implementation tickets

- [x] L1 Provider adapter: verified API contract, session isolation, strict schemas, pacing, safe normalized snapshots.
- [x] L2 Durable account store, serial synchronization, baseline/dedup/pending Telegram delivery.
- [x] L3 Admin protected connect/status/sync/settings routes, secret-free responses.
- [x] L4 Linkid workspace, account/profile sales/chat/notification UI and original-site actions.
- [x] L5 Fixtures, profile isolation, pagination, outgoing exclusion, failed send retry, restart and API authorization tests.
- [x] L6 Commit/push/deploy; connect current login, verify five profiles and existing Telegram destination, inspect rendered production UI.

## Local verification (2026-10-12)
- 38 targeted tests passed across seven files; production client build passed.
- Real dedicated server session read all five profiles and parties 75730–75734 successfully. Profile 3 had one preconnection invitation request, baselined without replay.
- Reviewed authorization, secret redaction, serial profile isolation, incoming message filtering, retry journal, Telegram deep links and workspace navigation.
- App type check retains 54 pre-existing diagnostics; none reference the new Linkid files or changed navigation files.

## Production verification (2026-10-12)
- Code release `2a475f4` committed, pushed and deployed to the existing aio-dashboard service.
- Dedicated account connected; all five profile snapshots refreshed on the server by 04:48:39 UTC without profile/provider errors; pending alerts 0.
- Existing Telegram integration returned sent:true for one labeled connection-check notice; dry-run was false.
- Authenticated dashboard showed profile-specific parties and the existing profile-3 invitation request. Unauthenticated API returned 403; public response omitted credentials; durable store mode 0600.
- Real chat rooms were absent at verification; incoming chat pagination/dedup/retry was covered by fixtures rather than buyer test messages.
