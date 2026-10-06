# GButs account registration

## Problem Statement
The seller wants to add new Netflix, Disney+, TVING and Wavve accounts before creating listings, just as in GrayTag. GButs workspace currently only selects existing inventory.

## Solution
Provide a GButs account management page with existing account registration and the existing email/password/PIN generator. Save accounts immediately, independently of listing publication. Record actual subscription payment and expiry before making inventory sellable. Offer a direct route to the correct account in the sales form.

## User Stories
1. As the seller, I open 계정 관리 from GButs home or its menu.
2. As the seller, I register an existing OTT login and password without sending credentials through chat.
3. As the seller, I generate a new email/password/PIN using the established GrayTag generator.
4. As the seller, I select Netflix, Disney+, TVING, Wavve or the established TVING+Wavve bundle.
5. As the seller, I save an unpaid account first and record actual payment and expiry later.
6. As the seller, I return to saved accounts after reload and reopen generated credentials when needed.
7. As the seller, I start a GButs sales draft for the selected ready account.
8. As the seller, my shared inventory counts each service/account once and keeps existing members and reservations.
9. As the seller, Spotify retains its existing invitation flow.

## Implementation Decisions
Reuse the generated account store, with optional manual-registration marker and expiry date. Manual registration must validate service, usable ID/password and calendar dates; repeat registration must not duplicate an account. Manual records have no SimpleLogin alias and must never delete one. Existing generated records remain compatible. A registered expiry must participate in shared management after cached reads as well as fresh reads. Unpaid/missing-expiry accounts have no sellable capacity. Retain exact-account selection in a sales draft by service and account query values. Protect new HTML route through the established login gate.

## Testing Decisions
Use established account registration HTTP boundary and shared inventory functions to verify persistence, duplicate rejection, invalid inputs, payment/expiry readiness, bundle mapping, no duplicated inventory and existing capacity reservations. Browser verification checks navigation and account form without creating real provider accounts or publishing listings.

## Out of Scope
External OTT signup/payment automation, Spotify account provisioning changes, automatically publishing listings, credential rotation for existing buyers.

## Further Notes
User confirmed all OTT services and account-first entry. Reuse existing local tracker and workflow; no additional parameter interview is needed for adding the registration interface.
