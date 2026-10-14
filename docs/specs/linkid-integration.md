# Linkid account/profile dashboard and Telegram integration

## Agreed scope (2026-10-12)
User requested analysis of the authenticated Chrome Linkid site and integration of login accounts, up to five subprofiles, their sales/1:1 chats, and existing Telegram notifications.

## Verified provider contract
Official production web client inspected on 2026-10-12. JSON POST uses `version-service: 3.0.1`.
- `/api/login`: provider/provider_id/pushTokenKey; returns a fresh sid, independent of the browser sid.
- `/api/users/auth`: sid; returns uid/acc_idx/nickname.
- `/api/users/list_subaccount`: sid; userlist entries acc_idx/uid/nickname/money/new_alarm.
- `/api/users/change_subaccount`: sid/acc_idx. Changes the active profile *on that sid*. Never use a browser sid for scheduled switching.
- `/api/party/tri_my`: sid; party and partyreq arrays.
- `/api/party/tri_partyinfo`: sid/partyid; party/member/pay. Credentials and payment details must not enter public snapshots.
- `/api/users/alarmlist`: sid/read/lastidx; list/result/totalcnt, id/type/date/partyid/msg.
- `/chat/room/list`: sid/partyid; array. `/chat/room/reload`: sid/partyid/ownerid/memberid/mindex/size; items/totalPage.
- Chat messages use CryptoJS OpenSSL salted AES passphrase format, confirmed in the official client. Plaintext is visible only in authenticated dashboard; Initial release sent only arrival notices. The 2026-10-14 update forwards buyer text to Telegram as requested; see `all-service-chat-contents.md`.
- Browser shows five named profiles, and Microsoft 365 seller parties 75730–75734 were verified by API across all five profiles. No chat rooms were present during verification; profile 3 had one existing invitation request. At initial release incoming chat delivery was fixture verified; a real chat notification was reported on 2026-10-14. Never create a test listing or message in customer rooms.

## Acceptance
- New Linkid workspace and entry in existing navigation; login account and profile selection stay distinct.
- Existing listing, participant, date, chat and bell status visible, with direct original-site links for operations.
- Connection imports only Linkid auth fields, verifies browser identity, obtains a separate server sid, and checks every profile uid before publishing data.
- Durable 0600 JSON, atomic saves, no secrets in API/Telegram/logs. Fail closed on invalid stores and provider schemas. All API routes admin protected.
- Serial profile switching/reads; request spacing and 429 backoff. Cached dashboard reads don't trigger provider traffic. One account failure does not stop others.
- First successful scan baselines old notifications/messages. Subsequent events have account/profile-scoped keys; failed Telegram sends remain pending; restart does not replay successful events. Read/unread bells both scanned without marking them read.
- Chat history paginates through events since last scan; outgoing/system messages do not trigger buyer inquiry alerts.
- Existing inventory, auto delivery and financial totals remain separate until explicit cross-market inventory binding is specified. Wallet balance is labeled wallet balance, not sales or profit.

## Release
Local source -> targeted integration tests, existing navigation/admin gates, build/review -> commit/push -> immutable production release -> live five-profile read and Telegram delivery smoke.
