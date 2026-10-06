# 01: Add GButs account registration and sales handoff

**What to build:** The seller can save an existing account or generate account credentials in GButs workspace, mark actual payment and expiry, and open a listing draft for the exact ready account.

**Blocked by:** None (can start immediately).

**Status:** complete

- [x] Registration and generator available from GButs home/menu.
- [x] Account credentials persist and pending accounts are visible without a listing.
- [x] Paid future-expiry accounts reach shared inventory without duplicate slots.
- [x] Unsupported services, invalid dates, placeholders and duplicate records rejected.
- [x] Manual registrations never create/delete a SimpleLogin alias.
- [x] Correct selected account survives sales navigation.
- [x] Tests, review, committed deployment and browser smoke verification.


## Verification

Implemented in 5cfcc17, a342556 and bc10489. Production release: bc10489, deployed 2026-10-06. Local build passed; 10 targeted suites / 127 tests passed including registration, inventory, UI handoff, session guard and buyer access. Changed files have zero TypeScript diagnostics; project-wide existing diagnostics remain. Full local suite remains affected by the existing macOS/procfs, legacy mjs runner and pre-existing API failures (153 failed assertions), matching the known preceding release limitation.

Authenticated runtime GET generated accounts and GButs overview returned 200; generated accounts response is no-store. Anonymous new HTML routes including trailing slash returned401; credentials API returned403. Empty registration returned400 without a record write. Browser verified GButs account menu, saved account list (43 records), registration inputs, all supported service options, manual bundle TVING ID field and generator mode. No real credentials, aliases, listings or buyer messages were created for verification. Account page left ready for the user.
