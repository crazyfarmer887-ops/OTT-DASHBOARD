# GButs and GrayTag shared OTT sales

## Confirmed scope

Netflix, Disney+, TVING and Wavve use the existing account inventory and buyer access pages. Both marketplaces share account capacity. GButs paid members receive an individual access URL in their private chat. Spotify remains on its existing Notion workflow.

## Inventory rule

Published capacity is reserved: GrayTag current members, pending orders and unsold listings, manual members, GButs published places and uncertain submissions all consume capacity. A place cannot be advertised on both marketplaces simultaneously. GButs publication validates a fresh GrayTag snapshot and reserves places before sending its single external write. Unknown outcomes retain the reservation and are never automatically retried. GrayTag writes for linked services also reserve capacity before publication.

## Delivery rule

Only a verified active paid GButs member can receive access. Listing ID + member ID identify the buyer; email does not join orders. Each order has a stable token and an at-most-once chat attempt, reconciled against seller chat history. Refunds and ended orders revoke GButs access. Unavailable order verification pauses delivery and access. Shared passwords/PINs continue to follow the existing maintenance record.

## Tickets and checks

- [x] Generic seller client, durable listing/delivery journal and shared capacity calculations.
- [x] Publication API and GrayTag capacity reservations.
- [x] Paid-member polling, individual access creation, chat reconciliation and cancellation.
- [x] Seller UI with per-account date, daily price, capacity, preview and publication.
- [x] Tests for capacity conflicts, uncertain writes, distinct buyer identities, duplicate polls, refunds and expiry.
- [ ] Build/review, commit/push, deploy and read-only production smoke checks.

Live publication requires the seller to choose the account, period, daily price and reserved count in the dashboard. No arbitrary test listing is published.

## Verification

- 141 relevant tests pass across inventory, API publication, private delivery, access control, existing Spotify delivery and GrayTag fill.
- Production client build passes; desktop/mobile browser checks have no page errors and no mobile horizontal overflow.
- Self-review added exact buyer/account ownership checks, incomplete-roster protection on close, calendar validation, shared-account checks before GrayTag assignment, and persistent uncertain-send protection.
- The existing project-wide TypeScript checks report pre-existing errors outside the new modules. The pre-existing party-access extension source-pattern test also fails on the unchanged HEAD pattern; neither is claimed as passing.
- Live OTT publication and a new paid buyer are not exercised by deployment. No test sale is published.

Production preflight found that unsold GrayTag rows have `productUsid` but no buyer `dealUsid`. The strict snapshot now accepts either stable identity, and management deduplication preserves distinct unsold products. The regression was reproduced before the fix (2 failures), then corrected locally.
