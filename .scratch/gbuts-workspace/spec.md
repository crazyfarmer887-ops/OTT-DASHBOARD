# GButs dashboard workspace

## Problem Statement

The dashboard's existing 사용 계정 menu has primary GrayTag and YouTube scopes. The seller wants a separate GButs choice, with GButs sales and Spotify operations instead of GrayTag navigation. The user confirmed that this means the existing selector, not a new login identity.

## Solution

Add 벗츠 전용 to the selector. Selecting it opens a GButs home, persists across reloads, and displays service sales overview, OTT listing creation, order/delivery management and Spotify invitation management. Netflix, Disney+, TVING and Wavve use the existing shared account inventory and delivery flow; Spotify retains its separate invitation flow. The existing choices remain usable.

## User Stories

1. As the seller, I select 벗츠 전용 from the existing 사용 계정 menu.
2. As the seller, I immediately reach GButs home and can choose a service, create its OTT listing, check orders or manage Spotify invitations.
3. As the seller, I retain my choice when reloading or opening another dashboard page.
4. As the seller, I do not see GrayTag menus or its realtime chat notifier in GButs mode.
5. As the seller, I can switch back to primary or YouTube operations using the same selector.
6. As the seller, existing GrayTag selections migrate without reconnecting or changing credentials.
7. As a buyer, my public account access page stays accessible regardless of the seller's local workspace choice.

## Implementation Decisions

- Persist a dashboard workspace separately from the existing provider session selection. GButs is a workspace, not a GrayTag account ID.
- Maintain compatibility with the existing provider-selection API and local browser preference.
- Use the primary shared-inventory scope for GButs requests and preserve explicit internally supplied provider headers.
- Render only supported operations in GButs mode; redirect unsupported dashboard routes before loading their page.
- Leave authentication, provider credentials, shared inventory and scheduled fulfillment unchanged.
- Load the home from live GButs listing metadata and order records without waiting for GrayTag inventory. Clearly distinguish displayed participants and listing recruitment capacity from paid buyers, settlement and shared inventory.
- Read order records separately from the inventory query; listing creation still performs the established fresh shared-inventory verification.
- Service cards preselect and filter available accounts for the chosen OTT service.

## Testing Decisions

- Check persisted workspace selection, legacy migration, switching back, and the outgoing provider header through existing public preference/fetch boundaries.
- Verify workspace route selection and public access exemption.
- Build and check the real dashboard selector, navigation and reload after deployment. No listing publication or buyer messages are needed to verify this feature.

## Out of Scope

- New login credentials or authorization roles.
- A second GButs seller account or separate account inventory.
- New authentication, profit calculations, standalone GButs account inventory or changes to automatic customer messages.

## Further Notes

Existing local ticket convention is reused. Scope confirmation is complete in the conversation; this is one complete workspace and sales-operation slice, expanded by the user to support new OTT sales.
