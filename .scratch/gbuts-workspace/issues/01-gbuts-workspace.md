# 01: Select the GButs dashboard workspace

**What to build:** Selecting 벗츠 전용 in 사용 계정 opens GButs home, retains the selection and shows home/listing creation/order delivery/Spotify navigation, while the seller can return to either existing GrayTag scope.

**Blocked by:** None (can start immediately).

**Status:** verifying-production

- [x] Existing preference migration and persisted GButs selection work.
- [x] GButs operations use primary shared inventory instead of the YouTube provider scope.
- [x] GButs mode exposes home/sales/orders/Spotify menus and avoids GrayTag page/notifier loading.
- [x] Existing account choices and public buyer access remain usable.
- [x] Live service overview and order records load independently of GrayTag inventory; service cards filter listing accounts.
- [ ] Relevant verification, review, commit and production deployment complete.

## Verification before release

- Targeted regression/UI/API tests: 8 files, 51 tests passed.
- Vite build and diff whitespace check passed.
- Standards review: no documented breaches; optional repeated service registry smell deferred for this fixed five-service scope.
- Spec review: query-navigation selection bug identified and fixed; follow-up reviewer confirmed resolution.
- macOS full-suite run: 106 files passed; 26 failed, including Linux procfs-dependent stores and node:test .mjs discovery. Linux full-suite comparison: baseline 115 files / 1130 tests passed, workspace 117 files / 1136 tests passed. Both had the identical 16 failure entries (15 files, 6 test assertions); no new failure.

- Production overview and orders: authenticated HTTP 200 (0.15s / <0.01s); unauthenticated HTTP 403. Current provider data: Spotify 1 listing, 5 members; new OTT services have no GButs listings yet.
- Production shared inventory: authenticated HTTP 200, 58 account records, 26 available seats; full fresh provider lookup took 49 seconds.
- Browser verified GButs selector, reload persistence, home overview and orders. Narrow-screen administrator badge was covering the selector, corrected locally before final verification.
