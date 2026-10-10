# BUTS + Graytag YouTube finance dashboard

Requested outcome: a white/black private dashboard at `dashboard.jamkkangudok.com` with platform totals, editable party-size sliders, account/seat cost thresholds, future payment dates and cash balance. Implementation is in the existing local OTT-DASHBOARD repository; the deployed runtime is not the source of truth.

Acceptance:
- Read paid current BUTS contracts and YouTube-only Graytag seller contracts without editing listings, invitations, orders or buyer messages.
- Show estimates distinct from platform-settled or bank-deposited amounts; never invent vendor costs or dates.
- Forecast 30/90/365 days, expire existing contracts and retain hypothetical added members for the selected horizon.
- Charge additional accounts/seats upfront today, existing units at the entered renewal date; retain any entered minimum paid units when membership shrinks.
- Separate amortized contribution from dated cash flow; handle monthly/annual billing and month-end dates.
- Persist cost and payout assumptions in a private file outside immutable releases; settings and finance reads require the existing admin authentication.
- Work on desktop/mobile; export summary and dated cash flow as CSV.

Data limits: BUTS uses the currently displayed listing daily price for confirmed paid members because the existing seller adapter does not expose historical buyer rates. Graytag uses contract price allocated across inclusive dates. Existing receivables, actual bank transactions, refund forecasts, taxes and operating expenses are excluded. Default 10% seller fee is editable. Unknown costs remain unknown. Do not enter shared bundle costs twice across services; configure the cost on one row and zero on the other if applicable.

`FINANCE_SETTINGS_PATH` optionally overrides the stable default `/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/finance-settings.json`. No credentials or buyer identifiers are returned in the finance snapshot.

Routing: the new hostname renders the finance page at all SPA entry paths. Existing deployment base `/dashboard/` and API routes are preserved; `/dashboard/finance` also opens the finance page on email-verify.one. The hostname uses the existing administrator login and host-only session cookie.

Deploy the committed revision as a new release, retain the preceding release, then apply `deploy/nginx/dashboard.jamkkangudok.com.conf` after DNS and certificate issuance. DNS belongs to Porkbun and requires a valid account session or DNS API credentials. Never install the TLS config before its certificate exists.

## Confirmed famhead terms (2026-10-10)

The owner confirmed $6 per account monthly, 5 saleable slots, all accounts billed on the 15th, and KRW 180 per slot per day after platform fees but before supplier cost. YouTube defaults now use the post-fee income basis for existing and added slots while retaining existing contract end dates. Fees are not deducted twice. Added accounts join the shared next billing date, without an invented upfront payment. Default reference FX is KRW 1340.44/USD from https://exchangerate.guru/usd/krw/10/ (2026-10-10); it is editable and is not an automatic card settlement rate. Dollar costs without an FX rate leave profit unknown. Legacy saved won plans retain their original behavior.

The custom hostname DNS and Let's Encrypt TLS were activated on 2026-10-10. Unauthenticated HTTPS returns the expected private dashboard login (401); HTTP redirects to HTTPS.

## Annual run rate and live FX

Summary cards, each service row, totals and CSV show annual run rates beside the selected-period forecast. Annual income holds today's active members and prices (plus hypothetical added members) constant for 365 days, assuming renewal, and uses exactly 12 months of supplier cost. This differs from the existing 365-day forecast that expires contracts and amortizes by 30-day months. Unknown costs remain unknown.

`GET /api/finance/exchange-rate` is admin protected and fetches Yahoo Finance USD/KRW market quotes. Quote timestamps, source and automatic rate are visible. Browser and server refresh at 60-second intervals; concurrent server requests share one fetch. Holidays and delayed quotes use the latest available market tick, not an asserted live trade or card settlement rate. Quotes older than seven days, future timestamps and implausible rates are rejected. Provider failures use a recent cached quote marked delayed, then each saved plan's explicitly labeled fallback rate if unavailable. Settings can disable automatic FX and fix the user's rate. Won costs are unaffected. Both forecasts and annual run rates recompute with the effective rate.
