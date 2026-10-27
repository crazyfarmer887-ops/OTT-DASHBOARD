# Verified GButs purchaser invitations through Steel

Owner request: import the supplied Google/YouTube session cookies into Steel and send Google family invitations automatically for the existing GButs YouTube sale. The provided session is John Leabe / johnleabezf102@gmail.com (described as Jack by the owner), matching the previously bound local automation. Do not enroll another original listing or family.

Bind original18756 and only its exact legacy INVITE repost chain. Obtain the recipient solely from the actual paid buyer's TEXT messages in their verified seller/buyer room, never GButs signup email. Recheck valid APPLY/refund status, period, seller, chain, room membership and safe mode immediately before sending. Ambiguous/changed/cancelled requests require review. No buyer acknowledgement, Telegram message, member removal, payment or renewal is authorized.

Use a separate owned Steel session, original cookie domains, no proxy or CAPTCHA bypass, no local Chrome extraction. Verify exact Google manager, every current/pending recipient, remaining capacity, active YouTube family plan and a live benefit end date covering the purchase. Use English Google family UI, identity on every detail page, exact recipient selection, one native Send click. Save a durable fsynced attempted record before the click. Uncertain writes are lookup-only; never retry Send. Gmail dot/plus aliases share one identity. Send at most one invitation per execution.

Dedicated server oneshot/timer every five minutes; no AIO/NBA code or service changes. Runtime wrapper privately reads only live AIO path/worker flags, one separate private Steel key, and drops privileges. Cookies/journal/status stay in private server files, outside Git. Migrate the existing observed buyer record after pausing the old Mac sender, then replace that heartbeat with read-only server monitoring to avoid competing senders.

## Verification

- [x] Steel read-only check confirms John manager, existing buyer exact email and four free seats. With Asia/Seoul timezone, active family benefits through2026-11-27 cover current sales through2026-11-26.
- [x] Google input/recipient chip selectors observed in the official UI without pressing Send; no synthetic invitation was sent.
- [x] Local tests: 478 pass across32suites, including23 invitation-domain tests and3 owned-session lifecycle tests. Isolated backend typecheck has only the pre-existing youtube-invitation-poller.ts:131 diagnostic.
- [ ] Commit/push and isolated Linux checks.
- [ ] Private cookie/journal migration, server read-only Google smoke, enable dedicated timer.
- [ ] Replace previous local sender heartbeat with server status monitoring and verify idle execution.

Official provider references: https://docs.steel.dev/overview/sessions-api/configuration and https://docs.steel.dev/overview/sessions-api/reusing-auth-context . No authentication values are included in this ticket or application logs.


## Authentication reuse follow-up

Local read-only Steel check succeeded, but two independent server cookie-only sessions returned the ordinary Google sign-in identifier page (`GOOGLE_SIGNIN_REQUIRED`). No invitation was attempted. A dedicated persistent Steel profile and an interactive Google sign-in session were created for owner login. The authenticated Steel app viewer rendered black when embedded; opening its observed live-player URL directly in Chrome displays the remote Google sign-in form. Do not expose its capability URL in public logs. Owner login is pending; do not mark server scheduling active before verifying a released/READY profile in a fresh server session.

Persistent-profile support restores that exact profile and never overwrites it with old exported cookies. The before-send safety check now rereads the current AIO worker flag and safe-mode path from the live process and the current private invitation enable flag. If any read fails, new sends are blocked. AIO/NBA runtimes are unchanged. Existing local heartbeat `google` is paused only during migration and must be restored if this turn remains blocked on login; pause it again and merge the latest local journal before final server activation.

Candidate71a3c3c was archived and verified with478 tests on Linux. Private server cookie/journal staging exists; server timer is not enabled or installed. No server success or automatic delivery has been claimed. The persistent-profile follow-up adds two lifecycle tests.


## Pending owner handoff, 2026-10-27 17:24 KST

Follow-up source `aa541a2` committed/pushed. Immutable candidate `/home/ubuntu/releases/gbuts-google-invites-aa541a2`, archive SHA256 `ab53f91146c5fcf84857d06823702d64a31fd397aba6e980d72c0f9db86f2b34`. All480 tests /32suites pass locally and in isolated Linux runs; no new backend type diagnostics.

The dedicated current symlink points to this candidate, but **server sending is disabled** in the private journal and no dedicated service/timer unit is installed. The private profile binding is staged with `awaitingOwnerLogin=true`; its bootstrap session is still interactive for owner Google sign-in. No Google invitation has been sent. Main AIO release/service and NBA remain untouched. Existing Mac heartbeat `google` has been restored ACTIVE with its original sender prompt to preserve delivery while the owner logs in; it is not yet a server monitor. Do not enable a competing server timer.

Resume: verify the owner's login in the owned bootstrap session, release only that session and wait for its profile READY. Pause the local heartbeat again, merge the latest local journal without discarding attempts/conflicts, then verify the released profile from a fresh server `--check-google` run while the server timer is still disabled. Only after successful manager/roster/benefit verification should the dedicated timer be installed/enabled, the old local sender disabled, and heartbeat `google` changed to read-only server status monitoring. The local output folder `gbuts-youtube-steel/README.md` has operational paths and the pending profile pointer. Never expose cookie values, provider keys or live-player capability URLs in logs.


## Cookie-only recovery diagnosis, 2026-10-27

The owner explicitly required cookie restoration without manual sign-in. A minimal unattended probe reproduced the exact failure (accounts.google.com/v3/signin/identifier, exit2). CDP verified all21 unexpired supplied cookies stored byte-identically and sent unblocked on the initial family request. Dropping service-specific OSID cookies, visiting the Google home SSO entry first, and preloading cookies through Steel sessionContext all remained red. Google home also displayed Sign in. Old released Steel contexts cannot be captured (documented live-session-only endpoint); no unavailable context was claimed recovered.

The original John Chrome profile remained authenticated after an actual family page reload. Using only visible Chrome profile/installed Cookie-Editor UI, exported the current Google cookies through clipboard and saved via TextEdit to a private0600 local file, without printing values. The refreshed snapshot differed in five rolling timestamp/check-cookie values, while long-lived credential cookies were not rewritten. Importing this current snapshot through sessionContext into the dedicated owned persistent profile succeeded: expected John family manager DOM, no password/OTP/user sign-in. Captured verified context privately BEFORE releasing the successful session; the same profile returned READY afterwards. Server profile/cookie staging updated, latest observed buyer journal preserved; old local sender paused/disabled during the final server checks. No test invitation has been sent.

A quiet authenticated profile now gets a read-only keepalive every15minutes, in addition to five-minute purchaser scans. New requests still use the ordinary verified recipient transaction; keepalive itself is check-only. Added tests cover due/undue keepalive, explicit checks, actionable orders and Gmail-alias idempotency. Final server fresh-session verification/timer activation remains pending below.
