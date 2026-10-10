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
