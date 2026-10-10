# GButs and GrayTag shared OTT sales

## Confirmed scope

Netflix, Disney+, TVING and Wavve use the existing account inventory and buyer access pages. Both marketplaces share account capacity. GButs paid members receive an individual access URL in their private chat. Spotify remains on its existing Notion workflow.

## Inventory rule

Published capacity is reserved: GrayTag current members, pending orders and unsold listings, manual members, GButs published places and uncertain submissions all consume capacity. A place cannot be advertised on both marketplaces simultaneously. GButs publication validates a fresh GrayTag snapshot and reserves places before sending its single external write. Unknown outcomes retain the reservation and are never automatically retried. GrayTag writes for linked services also reserve capacity before publication.

Unlinked legacy OTT posts block new publication when they are still on sale or have any members, even if their displayed end date has passed. A closed post with zero members no longer occupies shared capacity and does not block new publication. The dashboard shows the post status, member count and seller link so the seller can resolve any remaining occupied post without guessing its account.

An active unlinked legacy post is not part of the delivery poller's journal. The seller must choose its actual account once; linking verifies the live post, complete buyer roster, account period, shared capacity, Netflix profile availability and access credentials, then imports current orders into the same automatic delivery flow. The Orders page also lists unlinked posts and preserves its local order journal if the live seller-list read fails.

## Delivery rule

Only a verified active paid GButs member can receive access. Listing ID + member ID identify the buyer; email does not join orders. Each order has a stable token and an at-most-once chat attempt, reconciled against seller chat history. Refunds and ended orders revoke GButs access. Unavailable order verification pauses delivery and access. Shared passwords/PINs continue to follow the existing maintenance record.

## Tickets and checks

- [x] Generic seller client, durable listing/delivery journal and shared capacity calculations.
- [x] Publication API and GrayTag capacity reservations.
- [x] Paid-member polling, individual access creation, chat reconciliation and cancellation.
- [x] Seller UI with per-account date, daily price, capacity, preview and publication.
- [x] Tests for capacity conflicts, uncertain writes, distinct buyer identities, duplicate polls, refunds and expiry.
- [x] Build/review, commit/push, deploy and read-only production smoke checks.
- [x] Existing unlinked seller posts can be explicitly connected to their actual account and imported orders enter the automatic 1:1 delivery poller.
- [x] Unlinked posts are visible from Sales and Orders; order history remains visible during a temporary live-list outage.

Live publication requires the seller to choose the account, period, daily price and reserved count in the dashboard. No arbitrary test listing is published.

## Verification

- 146 relevant tests pass across inventory, API publication, private delivery, access control, existing Spotify delivery and GrayTag fill.
- Production client build passes; desktop/mobile browser checks have no page errors and no mobile horizontal overflow.
- Self-review added exact buyer/account ownership checks, incomplete-roster protection on close, calendar validation, shared-account checks before GrayTag assignment, and persistent uncertain-send protection.
- The existing project-wide TypeScript checks report pre-existing errors outside the new modules. The pre-existing party-access extension source-pattern test also fails on the unchanged HEAD pattern; neither is claimed as passing.
- Live OTT publication and a new paid buyer are not exercised by deployment. No test sale is published.

Production preflight found that unsold GrayTag rows have `productUsid` but no buyer `dealUsid`. The strict snapshot now accepts either stable identity, and management deduplication preserves distinct unsold products. The regression was reproduced before the fix (2 failures), then corrected locally.

Strict inventory reads use a separate in-flight cache key so a simultaneous normal dashboard load cannot bypass provider validation. Only verified seller-list responses determine shared capacity; a denial on the unrelated borrower probe does not substitute for these checks.

## Deployment evidence

- Final runtime commit 5bd2e92 deployed from the clean committed local source; service is active and private journal permissions are 0600.
- Production smoke: dashboard HTML/client asset 200, authenticated inventory 200, unauthenticated inventory 403, validated seller session 200, worker enabled and no journal error. No OTT listings/orders were created.
- At smoke time the inventory showed available places: Netflix 5, Disney+ 8, TVING 10, Wavve 3. These are point-in-time counts and refresh from the provider.
- Final profile review also excludes existing manual and recruiting profile names when allocating a new buyer.
- Follow-up bug reproduction: the new legacy-link endpoint initially returned 404 for a paid unlinked post. After adding the binding flow, targeted API, delivery, polling and chat transport checks pass (44 tests), and the production client build passes. No live seller post or buyer chat was modified during verification.

## Direct credentials on buyer request

Append `접근 링크 접속이 부담스러우시다면 "!"라고 남겨주시면 직접 전송해드립니다.` to new GButs OTT private delivery guides. A buyer-authored TEXT message whose trimmed content is exactly `!` requests `ID : {current login}
PW : {current password}` in that same verified order's private room. Existing confirmed orders can also request direct delivery. This applies to the four shared OTT services; Spotify retains its existing flow.

Read current credentials from the same account records used by the access page, and verify the paid buyer, account binding, active period and profile lease before disclosing them. Seller messages, other users, punctuation inside a sentence, refunds and expired orders do not trigger it. Journal the request fingerprint and outgoing hash before sending, without duplicating plaintext credentials in the journal. Repeated polls/restarts must not repeat a request; a later distinct request can fetch updated credentials. Retry only definite pre-send connection failures; reconcile uncertain sends from seller history and keep them visible in order errors.

- [x] Add guidance, direct credential resolver and durable request handling.
- [x] Verify real polling behavior, buyer isolation, current credentials, refunds/expiry, duplicate suppression and uncertain-send recovery.
- [x] Review and commit/push the tested local change.
- [ ] Deploy and verify production when server access is available.

Verification: six focused suites pass (66 tests), including the production DB resolver and actual private-journal round trip. Full suite: 1082 pass, 153 fail; the baseline commit has the same 153 failing tests (1068 passes before the 14 new cases). No new failure cases. Client build and whitespace checks pass. Worker typing retains unrelated existing errors; a duplicate Netflix profile import left in the preceding commit was removed. Standards review: 0 remaining findings. Spec review: 0 remaining findings. SSH to the configured production server still rejects authentication; this feature has not been deployed or exercised with a real buyer.

User-requested notice extension: after the direct-credential offer, explain that email-code verification still requires the access page, then state that refunds requested for inability to access the link or simple change of mind may be refused under GButs terms. Send each paragraph separately so GButs does not collapse the text into an unreadable bubble.
