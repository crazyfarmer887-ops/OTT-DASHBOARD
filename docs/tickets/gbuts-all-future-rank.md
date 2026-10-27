# Default rank renewal for every future GButs subscription listing

## Agreed behavior

The owner requested all future subscription-sharing listings, including Spotify and categories beyond Netflix/Disney/YouTube. E-coupons and digital codes are excluded. Start from a recorded seller-post watermark at authorization; never bulk-enroll old/paused listings. Automatically discover new listings created through either the dashboard or official seller UI. Existing explicit Disney/Netflix/YouTube policies remain intact.

Rank against each exact category's ordinary newest list. Renew only when rank>=5 and a different seller appears above; own posts never trigger churn. Minimum five-minute interval per original listing. Serialize mutation with shared inventory. Carry original capacity across the chain, subtract active/missing unrefunded buyers, read the final roster after closure, preserve original buyer/post/chat bindings. Keep exact current title/body/notices/day rate/countries/type/end date and private credential fields; never journal plaintext credentials. Closed/sold-out/expired seed posts do not get reopened just because they disappear from a public ranking.

Use the proven invitation renewal transaction as one common rank module, with category/type metadata and a hash of private fields. Persist closing/publishing before writes. Exactly one CREATE; unknown responses are lookup-only by frozen public payload plus credential fingerprint. Persist local delivery/inventory adoption idempotently before clearing the pending transaction. Pause/safe mode blocks new writes while uncertain CREATE lookup remains recoverable when explicitly permitted.

For managed OTT replacements, retain account/provider/profile/delivery records, close only the source inventory row and add the new remainder row. Spotify replacement posts remain in the existing Notion/message discovery list; Office's configured source expands to its chain. No buyer or Telegram test messages, credential resets, fabricated sales or historical migrations.

## Verification and release

- [x] Common rank transaction and backwards-compatible YouTube wrapper.
- [x] Durable future defaults/watermark/discovery and exact overlap exclusions.
- [x] Delivery/inventory adapters and authenticated status/default/pause/run routes.
- [x] Tests for categories/type/credential privacy, sold seats, roster races, disabled/safety, unknown mutation, adoption retry, automatic discovery, old-policy exclusion and delivery continuity.
- [x] Local tests/build/review -> commit/push -> archived release -> Linux checks -> deploy/smoke -> activate captured watermark -> update existing heartbeat.

## Local verification

382 focused tests across 29 suites and client build pass. Existing TypeScript diagnostic youtube-invitation-poller.ts:131 remains unchanged; no new module diagnostics. Self-review added private credential fingerprints, before-close payload checks, category isolation, fresh cross-market quota verification both before close and CREATE, final safety/expiry rechecks, pending inventory reservations before mutations, and idempotent local adoption. A future managed listing's old renewal toggle now controls its common policy without spawning a competing old-engine policy.

Recorded seller watermark18858 at2026-10-27T06:45:56.390Z. Initial activation uses this cutoff; the scanner excludes actual old-engine chains (including paused ones), not all new posts sharing an old account. No synthetic listing/customer message is needed for verification.


## Production release — 2026-10-27

Implementation `b8d76f4`, final inventory race fix `fcb7f1e58dd38f92bb8f5290c31865edb7b03f83`. Local and isolated Linux runs: 382 tests / 29 suites pass; client build passes on both platforms. The only isolated backend TypeScript diagnostic remains the pre-existing `youtube-invitation-poller.ts:131` unknown-to-string diagnostic. Final review imports actual final-roster buyers into shared inventory before releasing old recruitment, keeps unrefunded missing buyers occupied in all categories, and prevents older rank snapshots overwriting a fresher order/refund check.

Deployed immutable archive to `/home/ubuntu/releases/aio-dashboard-fcb7f1e` (SHA256 `6a472571fefa5970f227cbe872cc517ba2d9189fc55ec735912277d97ccf0e41`). The existing dependency lock is identical; reused installed dependencies, built the candidate before switching only aio-dashboard. Private data and the previous service override were backed up before switching; previous release `aio-dashboard-b8d76f4` remains available. No NBA monitor code or service was changed.

Future defaults activated at 2026-10-27T07:03:38.055Z with cutoff18858; final deployment preserves that cutoff rather than resetting it. At 07:18 UTC, authenticated general/OTT/YouTube status endpoints return healthy; general defaults enabled, worker enabled, safe mode false, watermark18864. Discovery advanced after final restart from 07:17:19.853Z to 07:18:20.714Z without an error; NBA hourly timer remains active. No new policies are expected yet: intervening listings are existing managed renewal chains and are excluded. Existing17OTT policies and1YouTube policy retain rank threshold5, no error/pending; legacy policy configuration fingerprint is unchanged (`7a723c26a5b695121864abd7811e69618130db624a42405206e21c11801742db`). Unauthenticated general status returns403. Recent Spotify completion events exist; no rank error or Netflix code connection error is observed. No synthetic listing, credential reset, or test buyer message was created.

Updated existing heartbeat `automation` in place to include all future subscription categories and the general discovery/rank endpoint, while preserving legacy checks, confidentiality, no test messages, and quiet normal monitoring. E-coupons/digital codes remain outside the scope. Real displaced-listing publication will occur naturally only when an eligible future listing reaches the rank condition.
