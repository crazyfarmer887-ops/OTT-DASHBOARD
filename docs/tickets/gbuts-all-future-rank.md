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
- [ ] Local tests/build/review -> commit/push -> archived release -> Linux checks -> deploy/smoke -> activate captured watermark -> update existing heartbeat.

## Local verification

379focused tests across29suites and client build pass. Existing TypeScript diagnostic youtube-invitation-poller.ts:131 remains unchanged; no new module diagnostics. Self-review added private credential fingerprints, before-close payload checks, category isolation, fresh cross-market quota verification both before close and CREATE, final safety/expiry rechecks, pending inventory reservations before mutations, and idempotent local adoption. A future managed listing's old renewal toggle now controls its common policy without spawning a competing old-engine policy.

Recorded seller watermark18858 at2026-10-27T06:45:56.390Z. Initial activation uses this cutoff; the scanner excludes actual old-engine chains (including paused ones), not all new posts sharing an old account. No synthetic listing/customer message is needed for verification.
