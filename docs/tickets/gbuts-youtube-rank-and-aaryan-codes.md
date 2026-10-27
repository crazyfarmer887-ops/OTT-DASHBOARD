# GButs YouTube rank renewal and Netflix Aaryan codes

## User request (2026-10-27)

1. Move the current YouTube Premium GButs invitation listing up like Disney/Netflix: rank>=5 only when a foreign seller is above it, no churn from own posts, minimum five minutes per original listing, one replacement at a time. Preserve INVITE delivery, existing members and their original chats, latest public description/notices/day price/real end date; sell only unsold places. Current source is post18756, category7, INVITE, memberLimit5, day190, ending2026-11-26.
2. Inspect @Aaryanac_bot's allowed-email list. Match a real paid buyer's current assigned account, request that exact allowed email from the bot, distinguish4-digit sign-in and6-digit account/household codes, and privately deliver a fresh code to the requesting buyer only. Never reset a password, forward reset links, use stale/ambiguous/wrong-email responses, or claim a manual-only bridge is automatic. The bot's Web Access is disabled; server automation requires a legitimate owner Telegram user session. User is opening official API development settings; no keys/session may be printed or put in Git.
3. Register supplied angel01 account as Netflix, one month, day190, direct private ID/PW plus code-on-request guide. Preserve existing password-only Netflix accounts' policy. Check current account/expiry/capacity and avoid duplicate publication.

## Implementation and checks

- [x] Separate durable YouTube INVITE renewal journal, seeded by exact seller post. Original capacity is fixed; missing unrefunded members hold seats until expiry. Refresh current and occupied history; read final closure roster before publishing.
- [x] Persist closing/publishing phase before mutations; one CREATE only. Lost or uncertain response is reconciled from later seller posts using frozen full public payload; no blind retry. Paused/safe mode blocks new publication.
- [x] Keep YouTube category out of shared-account inventory and never publish a family manager password. Expose authenticated state/bind/run routes; integrate existing serialized poll loop.
- [x] Scoped Netflix email-code provider/guide on the new listing only, Telegram user bridge with strict bot+allowed emails, per-request correlation, freshness and exact buyer revalidation before private delivery. Hash-only code delivery journal.
- [x] Regressions for foreign rank vs own rank, sold seats/final roster race, missing seats, unknown CREATE recovery/no duplicate, safe/disabled pending recovery, identity/expiry validation, code kinds/freshness/sender mismatch, membership changes and duplicate/uncertain sends.
- [x] Focused tests/build/review; committed local source -> push -> deployment -> smoke. Leave NBA release and unrelated services/settings alone. Update existing heartbeat to cover YouTube once enabled.

## Pre-deployment verification

356 focused tests across27suites pass; client build and whitespace checks pass. Isolated Telegram parser/adapter/auth-helper TypeScript passes. Scheduler imports retain the existing unchanged youtube-invitation-poller.ts:131 unknown-to-string diagnostic. Self-review added final code-expiry and safety revalidation. Live owner-session identity and pinned bot identity match. The bot first emits an unthreaded exact-email selection menu; the adapter chooses only its correct code button, rejects intervening outgoing queries, and accepts only a subsequent code reply correlated to the exact query. A fresh4-digit sign-in code dated2026-10-27T05:51Z was privately fetched and accepted by Netflix, reaching authenticated browse; no code/password/session was logged or journaled.

The supplied account shows Premium and next billingNovember17. The owner explicitly approved extending throughNovember25. The final profile configuration is1,2,3,4,5, with the existing primary profile renamed5 as explicitly requested; all five were read back in the live UI. Private Telegram configuration is stored0600 outside the repository; runtime path /home/ubuntu/.config/gbuts/aaryan-telegram.json.

## Deployment and sale verification — 2026-10-27 KST

Runtime61c465c was pushed, archived and verified with356focused tests on both local and production Linux plus client build. All dependencies were installed from its exact committed lockfile in a private release directory; no shared/NBA dependencies were modified. The final runtime8a81beb adds a bounded single bot callback acknowledgement: a provider may send a code reply without completing the callback RPC. A never-acknowledged callback regression passes;357focused tests pass locally, and all5Telegram transport tests pass against the final production source. The unchanged frontend build/dependency lock were reused from61c465c.

Active AIO release: /home/ubuntu/releases/aio-dashboard-8a81beb, PID1878226. Shared data and prior systemd release configuration were privately backed up before activation. Authenticated OTT/orders/YouTube endpoints return200, unauthenticated YouTube state returns403. Existing16OTTpolicies are preserved and the new Netflix policy brings the count to17; all are enabled, rank-triggered, threshold5, with no errors/pending mutation. NBA remains at2f81a18 with its timer active. Spotify completions continue.

YouTube seed18756 is enabled with category7 INVITE unchanged. Latest verified rank3, with advancing rank-check/nextAt and no pending/error; no unnecessary repost was forced. Existing hourly heartbeat was updated in place to include its separate authenticated state/run endpoints.

The owner-supplied Netflix account was recorded through the manual account API and published exactly once with requestgbuts-netflix-angel01-20261027, post18844. It has5places, day190, end2026-11-25 and emailCodeProvider=aaryan. Public UI shows0/5,29days and5510total; the title and description advertise email-code support and private directID/PW, with no public credentials or email-verify access link. The account's new rank policy is enabled and read back at rank1.

Telegram owner/bot identity and correlated email-code replies were verified directly from the server without exposing code values. The new4-digit code was accepted by Netflix in the owner browser, and the final profile list was read back. No real buyer code request exists yet, so no synthetic request or code was sent into a customer chat. Paid-buyer binding, refund/safety/freshness revalidation, ambiguity clarification, duplicate suppression and uncertain-send reconciliation are covered by tests.
