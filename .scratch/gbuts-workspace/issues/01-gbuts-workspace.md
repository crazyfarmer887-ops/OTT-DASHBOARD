# 01: Select the GButs dashboard workspace

**What to build:** Selecting 벗츠 전용 in 사용 계정 opens GButs home, retains the selection and shows home/listing creation/order delivery/Spotify navigation, while the seller can return to either existing GrayTag scope.

**Blocked by:** None (can start immediately).

**Status:** complete

- [x] Existing preference migration and persisted GButs selection work.
- [x] GButs operations use primary shared inventory instead of the YouTube provider scope.
- [x] GButs mode exposes home/sales/orders/Spotify menus and avoids GrayTag page/notifier loading.
- [x] Existing account choices and public buyer access remain usable.
- [x] Live service overview and order records load independently of GrayTag inventory; service cards filter listing accounts.
- [x] Relevant verification, review, commit and production deployment complete.

## Verification before release

- Targeted regression/UI/API tests: 8 files, 51 tests passed.
- Vite build and diff whitespace check passed.
- Standards review: no documented breaches; optional repeated service registry smell deferred for this fixed five-service scope.
- Spec review: query-navigation selection bug identified and fixed; follow-up reviewer confirmed resolution.
- macOS full-suite run: 106 files passed; 26 failed, including Linux procfs-dependent stores and node:test .mjs discovery. Linux full-suite comparison: baseline 115 files / 1130 tests passed, workspace 117 files / 1136 tests passed. Both had the identical 16 failure entries (15 files, 6 test assertions); no new failure.

- Production overview and orders: authenticated HTTP 200 (0.15s / <0.01s); unauthenticated HTTP 403. Current provider data: Spotify 1 listing, 5 members; new OTT services have no GButs listings yet.
- Production shared inventory: authenticated HTTP 200, 58 account records, 26 available seats; full fresh provider lookup took 49 seconds.
- Browser verified GButs selector, reload persistence, home overview and orders. Narrow-screen administrator badge was covering the selector, corrected locally before final verification.

## Final production verification

- Deployed committed release `07a098b`; service active. Repository branch pushed to origin.
- Latest production overview HTTP 200 in 0.09s; order journal HTTP 200 immediately. HTML routes and trailing slash variants require dashboard login; unauthenticated API requests require administrator authentication.
- Final fresh inventory HTTP 200: 58 records, 26 sellable places, zero sellable `(직접전달)` placeholders. Cold read took 71.5s after transient upstream rejections; subsequent browsing uses the verified snapshot while refreshing in the background.
- Browser confirmed all three account choices, GButs reload persistence, five service cards, order view, Spotify invitation view, and Netflix filtered listing form. Actual form showed three genuine Netflix choices, prefilled price/period, and enabled registration. No listings or customer messages were created by verification.
- Latest affected capacity/API/fulfillment/UI/session regression run: 5 files / 49 tests passed. Earlier workspace/cache regression run: 10 files / 59 passed. Builds and whitespace checks passed; full-suite baseline failures documented above.
- Remaining operational characteristic: cold provider inventory reads may take 1–2 minutes or fail temporarily during upstream denial; cached browsing is labeled when stale, and registration/fulfillment continue to require fresh verification.
