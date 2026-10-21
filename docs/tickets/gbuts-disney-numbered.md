# Disney numbered listing

- [x] Inspect existing inventory, listing, order, private chat and public access flows.
- [x] Add dedicated numbered Disney delivery and password-only buyer views.
- [x] Verify allocation/restart/refund/isolation, delivery idempotency, API persistence and both renderers; build and review.
- [x] Commit, push, deploy local source and verify production.
- [x] Register the requested account and publish one real six-place listing; verify seller page.

Pre-deploy: 109 targeted tests pass across ten suites; client build passes. Server type check retains existing diagnostics in chat/finance/Spotify modules and API index, with none in the changed modules. Self-review checked stable/refund/missing leases, legacy flow preservation, mailbox suppression in both renderers, no credentials in public copy, existing admin authentication, and no extra React effects or data fetches.

Production: committed release `ca38a48` built on the server and activated with all existing environment directives and shared data paths preserved. Service active with zero restarts; unauthenticated orders API 403. Authenticated dashboard verified six available places and new password-only numbering notice. Registered the user-supplied account through the existing UI and published exactly one listing, #17436, 150 KRW/day, six places, October 21–November 20 (provider displays 30 days). Seller page verified recruiting 0/6, period, price and approved description. Private journal read-back verifies registered state and `disney-numbered-password`; background sync advanced with no error. No synthetic buyer or chat was created. Screenshotted the real seller page in the chat workspace.

## Direct credential request follow-up

- [x] Inspect existing verified buyer `!` handler: it already covers numbered Disney leases and reads current credentials at request time.
- [x] Add Disney-specific private guide text offering `!`, without Netflix email-code guidance.
- [x] Verify the actual Disney poller/request/resolver, then commit/push/deploy and check runtime health.

Direct-request verification: 47 tests pass across four suites, including numbered Disney private-room isolation, one reply per buyer request, current credential changes on a later request, no plaintext credentials in the request journal, real resolver lease validation and refund denial. Client build passed. Release `e973aa5` pushed and deployed from the local Git archive; service active with zero restarts, deployed guide includes the `!` offer, production polling advanced and lastError remains null. Existing buyer for #17436 already had the old guide; sent the new non-secret usage notice once via the seller 1:1 UI and verified it in history. No synthetic buyer request or credential message was sent.

## Tinyhost email-code link

- [x] Implement explicit per-account Tinyhost setting, account-matched URL, both page renderers and revised fallback copy.
- [x] Verify identity checks, unconfigured accounts, existing consent and both rendered links; commit/push/deploy.
- [x] Enable only the requested account, verify its existing buyer access page and update the live listing's contradictory copy.

Tinyhost pre-deploy: 71 focused tests across six suites pass; client build passes. Review kept internal-mailbox validation and frame CSP unchanged, restricts Tinyhost to the explicitly enabled Disney account, requires matching mailbox path and login identity, opens a new tab without referrer, and preserves consent redaction.

Tinyhost production: release `3a41fae` built from pushed local Git source and activated, preserving all service environment/data paths. Enabled `emailAccessProvider=tinyhost` for only the requested account via authenticated existing account PATCH; private pre-change backup retained. Actual existing buyer access page now displays a matching `https://tinyhost.shop/<login-email>` new-tab link with `noreferrer`, without a PIN prompt. Opened the exact destination and verified the Tinyhost Inbox page. No mailbox contents or codes were needed. Seller listing #17436 now describes password sign-in as default and TV email-code fallback; original price/period/recruitment remain. Service active with zero restarts; polling has no error. Screenshot in the chat workspace shows the live link without exposing the password.

## Four additional five-place listings — October 21

- [x] Use actual listing capacity in the Disney private guide (1–5 for five-place sales, preserve 1–6 for the first six-place listing). 49 targeted tests and client build pass; release `666580e` committed/pushed/deployed, preserving environment and data paths.
- [x] Register the four supplied existing accounts through the authenticated registration API, with paid status, expiry November 20 and account-specific Tinyhost provider. No credentials were committed.
- [x] Publish exactly four idempotently journaled listings: #17451, #17452, #17453, #17454. Each is ON_SALE, 5 places, 150 KRW/day, October 21–November 20. Seller API read-back verifies each post and its exact account binding; the first seller page also verified in the browser.
- [x] Description prominently discloses overlapping simultaneous viewing and temporary limits, asks buyers to review/agree before purchase, and qualifies refusal of refunds for the disclosed limitation with marketplace policy and statutory rights. No unconditional waiver or automatic refund rejection was added.
- [x] Existing numbered profile allocation, verified buyer access, live `!` credential requests and Tinyhost code links remain connected. Production poll timestamp advances with lastError null. Private operational receipt: `disney-five-registration-20261021.json` in the shared data directory. Temporary credential input files removed after verification.

## Refund wording revision — October 21

At the user's request, superseded the qualified refund sentence on all four live listings (#17451–17454) with: “사전에 안내한 동시 접속으로 인한 일시적 시청 제한을 사유로 한 환불은 불가합니다.” Each saved seller detail page was read back in the browser and confirmed to contain the new sentence. This is a listing-copy change; automatic refund processing was not changed.

The provider's edit form rejected the previous titles for exceeding its 30-character limit. Shortened all four to “1개월 · 5인 · 비밀번호 로그인” so the edits could save. Existing 150 KRW/day, five places and November 20 expiry remain. Screenshot of the saved fourth listing is in the chat workspace artifacts directory. No application release is needed for this operational text update.

Subsequently removed the party-size wording from all four titles at the user's request. Seller index read-back verifies #17451–17454 now use “1개월 · 비밀번호 로그인”; actual capacity remains five.

## Automatic private ID/password delivery

- [x] Extend the existing numbered Disney delivery flow to send current credentials after the private guide without waiting for `!`, including active buyers who have no direct-delivery journal.
- [x] Preserve explicit refresh requests, other-service behavior, paid buyer/account/profile/room validation and hashed journaling without plaintext passwords.
- [x] Verify automatic private delivery, duplicate prevention, pre-send retry, uncertain-send reconciliation, restart, refunds, wrong rooms and duplicate profiles. 55 focused tests across four suites and client build pass. Review checked that initial delivery uses the existing current-credential resolver and never places credentials in public templates or `deliveryMessage`.
- [x] Deploy committed source and verify existing eligible buyer delivery and production health.

Production: pushed source `c5e08f8` built and passed the same 55 tests on the server, then activated at `/home/ubuntu/releases/aio-dashboard-c5e08f8`. Existing service settings/data paths preserved. Authenticated orders endpoint returned 200, automatic sync enabled, zero unlinked sales, lastError null, service active and zero restarts. The two active Disney orders without direct-delivery journals (#17436:48228 and #17436:48280) now have confirmed credential delivery; read-only provider chat checks matched each stored message hash to an actual seller message in its buyer room. Already confirmed credential sends were retained, and the refund-requested buyer received no new automatic delivery. No synthetic buyer/message was created. Broader server type checking retains existing unrelated diagnostics; no diagnostics name the changed modules.

## Native GButs credentials and concise mailbox delivery

- [x] Supersede the access-link flow in the existing spec. Resolve native seller fields and buyer chat from current account storage/maintenance; construct a matching Tinyhost URL only for explicitly configured accounts.
- [x] Add native field creation and change-only synchronization using the provider's own seller edit protocol. Preserve actual live title, price, capacity, dates and public notices without exposing secrets there.
- [x] Send a short profile guide and a versioned ID/password/mailbox/refund message. Maintain explicit `!`, private buyer verification, credential-free journals and complete split-message reconciliation. Hold automatic migration where seller already agreed to a refund.
- [x] Complete tests/review, commit/push, deploy, verify native fields and actual buyer chat receipts.

Production: source `1aa18bd` built and passed 85 tests on the deployment host. Backed up all five provider posts and the private sales journal before the first native edit. Canary #17453 verified native ID/password read-back and unchanged 150/day, five places, November 20 expiry. Activated the release with all service settings/data paths preserved. All five Disney posts now read back the matching current native credentials and direct after-order notice, preserving their original six/five-place capacities and public sale settings. Seller browser confirmed real native fields and revised pre/post-purchase copy; no public description or notice contains credentials.

Five existing active buyers received exactly one two-part credential/mailbox/refund supplement. Provider chat timestamps truncate milliseconds, initially leaving four delivered messages awaiting confirmation. Fixed this at source in `4d460f7`, added a precision regression test and deployed the committed fix after all 86 focused tests and the production build passed. All five receipts now confirm against real chat history with exactly one copy per part; no credential message was resent during recovery. One refunded and one refund-requested order retained their old records and received no supplement. Service active, zero restarts, authenticated orders endpoint 200, automatic sync enabled, no unlinked sales and lastError null. Broader server type check retains unrelated existing diagnostics, with none naming the changed delivery/client modules. No synthetic buyer or test chat was created.
