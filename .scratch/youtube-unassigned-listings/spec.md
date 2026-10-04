# YouTube vendor-pool listing

## Problem Statement

The seller currently has to create and select a Google family manager before posting each YouTube invitation listing. The vendor actually chooses any available family account when inviting the buyer, so this setup step slows down sales and makes the dashboard's group assignment misleading.

## Solution

Let the seller register YouTube listings without creating or selecting a family account. The seller chooses a subscription end date, a daily price (default 150 KRW), and a listing count. The registration is durable and idempotent, with no fictitious manager assignment. The existing buyer-chat-to-Notion and invited-to-delivery flows continue to handle fulfillment after a sale.

## User Stories

1. As the seller, I can choose YouTube, set a subscription period and price, and publish without entering an account.
2. As the seller, I see 150 KRW/day prefilled and can change it or switch to a total price.
3. As the seller, I can choose how many separate listings to publish and see the calculated total.
4. As the seller, I can see which registrations succeeded or have an uncertain outcome, and an uncertain request is never blindly repeated.
5. As the fulfillment partner, I can invite a paid buyer into any suitable family account; no arbitrary manager email appears in the sales listing.
6. As the seller, I retain the existing Notion email capture and invited-to-delivery automation for sales from these listings.
7. As the seller, existing family-specific listings and their history keep working.

## Implementation Decisions

- A pooled registration has a durable identity distinct from a real family group; its seller-facing API and UI do not expose an invented group assignment.
- Keep the existing provider registration, audit, idempotency, and uncertain-outcome reconciliation.
- The existing family-specific endpoint remains supported for previously created listings and automatic batches.
- Pooled sales are fulfilled by the existing Notion flow. The family-specific invitation lifecycle must not assign them to an imaginary group.
- Listing count is explicit and defaults to one. The seller confirms that the vendor can fulfill those seats. The registration journal prevents duplicate requests. A listing is not an occupied family seat: the current 113 registered listings already exceed the 85 paid slots, so a slot-count gate would incorrectly block new listings.

## Testing Decisions

- Test the browser request contract and daily-price default.
- Test pooled registration at the API seam, including replay, uncertain outcomes, and no family-group dependency.
- Test downstream provider ingestion and capacity validation for pooled records.
- Run the existing YouTube registration and Notion sync tests, type checking, and build.

## Out of Scope

- Automatically choosing a real family account for the vendor.
- Sending WhatsApp notifications or automatically replenishing GrayTag listings; these are separate follow-up changes.
- Treating the currently inaccurate Notion seat summary as proof of physical Google-family vacancy.
