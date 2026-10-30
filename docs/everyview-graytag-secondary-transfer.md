# Disney Everyview → GrayTag secondary transfer

The owner corrected the destination to GrayTag secondary: remove the four unoccupied Everyview Disney parties and publish each reserved sixth profile at KRW105/day for30days. Existing GButs posts and buyer terms remain unchanged; the unknown fifth Everyview submission remains held.

Use the committed `scripts/migrate-everyview-disney-to-graytag.ts` operational script. Without `--apply` it only verifies seller sessions, complete empty source rosters, source/account bindings, available account periods, and delivery credentials. Apply requires aio-dashboard to be inactive so other workers cannot overwrite the private shared inventory during transfer. Backups precede mutation. Each provider write has durable before/after journal state; uncertain deletion or registration is read back, never blindly resubmitted. No password, cookie, buyer identifier or access link is printed or copied into the transfer journal.

The former Everyview hold becomes an explicit secondary GrayTag claim on profile6. A verified retired-party tombstone prevents startup recovery restoring removed monitors. Native GrayTag automatic delivery is saved and read back before marking the claim registered. Other GrayTag claims and uncertain claims retain the original fail-closed behavior. GButs allocation remains in1–5; a registered secondary sixth seat does not disable the existing five-place renewal quota. Shared inventory continues reserving the secondary place until its fixed end date, including after configuring its native credentials.

The date is fixed by the official GrayTag product form, rather than rolling per buyer:2026-10-30 through2026-11-29, total KRW3150 at initial publication. Later buyers see the remaining period. Each listing explicitly states the fixed end date.

Provider read-back clarified two contracts: the GrayTag list uses the date difference (not inclusive dates), so30remaining days end on November29; and `keepMemo` is absent from the seller-list JSON and must be read from the saved private delivery form. The first created product is reconciled and corrected in place only while unsold, never registered twice.

## Verified completion —2026-10-30

Final committed release `454a0a4` deployed with matching archive checksum and authenticated HTTP200 health. Everyview owned-party reads contain zero of the four retired targets707–710. Secondary GrayTag products `0000000046EKU`, `0000000046EKV`, `0000000046EKW`, `0000000046EKX` are all OnSale, each with purePrice3150, remainderDays30, derived daily rate105, end2026-11-29 and native productKeepAcctYn=true. ID/password match the authoritative account and the private native memo includes profile6 plus the correct email-access instructions. All four transfer records are configured and all four shared claims registered. No buyer message or test purchase was generated.

Regression suites passed106 tests before rollout; after read-back contract correction, the focused77 tests (including the new date and saved-memo cases) passed. The source ledger, configurations and restart-recovery tombstones retain historical evidence while preserving existing GButs prices, leases and chat histories. The uncertain fifth Everyview submission was outside the four confirmed source parties and remains untouched.
