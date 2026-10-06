# GButs Netflix numbered profile rooms

## Problem Statement
The seller will pre-create Netflix profiles named 1 through5. Existing GButs delivery invents profile names and tells buyers to create/delete profiles. Buyers need a fixed assigned number, updated credentials and integrated email verification without a separate dashboard address.

## Approved Solution
Persist five numbered places per Netflix login. Assign verified buyers in purchase order. Keep existing assignments stable; reuse a confirmed-refunded or expired place for the next buyer, retaining historical allocation. Pending cancellation or missing/uncertain roster states must not free a place. Warn and stop if shared GrayTag/manual usage cannot be mapped to a unique numbered profile. Keep other OTT and Spotify flows unchanged.

## User Stories
1. Seller creates actual Netflix profiles 1..5; software only assigns these names.
2. Buyer receives the approved 1:1 guide containing assigned profile number and private access link.
3. Returning buyer keeps their profile number across polling, listing changes and restart.
4. New buyer receives profile3 after its previous occupant has confirmed departure/refund or expiry; others retain their numbers.
5. Seller never double-books a profile across different listings for the same account, concurrent operations, existing GrayTag users or manual members.
6. Pending refunds, missing rosters and ambiguous existing profiles pause reuse/delivery rather than guessing.
7. Buyer sees ID, password and email PIN after existing consent and sees no profile grid/create/delete instructions or separate mail dashboard link.
8. Buyer can read login/household verification mail inside the same access page with the existing email PIN gate.
9. Seller gets approved Netflix rules as the default new GButs listing description; existing GrayTag and other service descriptions stay intact.
10. Buyer is informed not to change profile names, PIN, account credentials or payment settings and of the approved conditional legal-action warning.

## Implementation Decisions
Use existing serialized inventory transactions and order journal. Add original purchase timestamp, profile number and release history to orders. Allocate deterministically across all listings of the same account before sending any message; validate old assignments and number conflicts. Unknown previous delivered profile names require confirmation rather than renumbering. Returned inactive unknown states hold the lease until refund or expiry. Reactivated released order cannot claim a reused lease.
Compact presentation is selected by trusted GButs Netflix member provenance in the server payload, including redacted consent payload. Preserve existing consent phrases and secret redaction; replace profile/create/delete copy in this view. Integrate the existing approved-origin email view after consent without an external URL/link or changes to its PIN authentication.
Add service-specific GButs templates. New seller defaults use the approved text; provider create payload and server fallback use the same default. No unsolicited messages to old delivered orders. Existing current GButs inventory has no Netflix listings/orders at approval.

## Testing Decisions
Use current sync boundary with fake provider and real journal transformations to test all5 assignments, ordering, persisted reload, hole reuse, pending/missing hold, duplicate/mapped external occupancy and no duplicate sends. Test buyer payload redaction/provenance and UI behavior; preserve GrayTag view, existing consent and email-origin filtering. Build, changed-file type checks, code-review and committed deployment smoke checks.

## Out of Scope
Actually creating/deleting Netflix profiles, logging out streaming devices or changing passwords/PIN, Spotify behavior, renaming GrayTag profiles, automatic migration of ambiguous old users, creating test listings or sending messages to real buyers for verification.

## Further Notes
User reviewed exact listing and chat copy and explicitly approved implementation and deployment. Preserve local workflow; no further interview is needed.
