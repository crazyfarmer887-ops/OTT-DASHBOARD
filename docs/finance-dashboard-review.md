# Finance review against 90c1e4e

Standards: local existing repository used; private file outside release; no credentials or customer identifiers returned; admin-protected reads and writes; Hono/React patterns retained; Tailwind v4 global CSS preserved with scoped finance overrides. React review checked derived calculations, direct icon imports, no extra chart dependency, labeled controls, modal focus trapping/Escape, responsive overflow and reduced motion.

Spec: separate BUTS and YouTube-only Graytag; confirmed active contract filters; existing expirations; member sliders and account thresholds; cost periods and retained paid capacity; upfront new-unit payments; monthly clamped dates; amortized contribution separate from cash flow; CSVs; stored assumptions and private host routing. Unknown supplier amounts/date retained explicitly, not fabricated. Bank deposits are modeled assumptions, not asserted actuals.

Review fixes: removed optimistic high-price contract selection when reducing members; reduction scales existing earnings proportionally. Default retained accounts reflect current party count. New accounts charge upfront today. Empty successfully read services differ from failed platforms. Root width explicitly overrides old mobile-only dashboard styling. Icon-only narrow sidebar buttons retain accessible labels. Login return path preserves finance view without allowing arbitrary redirects.

Verification: 47 focused tests pass (model, API, admin auth, session, server auth and GButs overview); Vite build passes; isolated finance UI/model strict TypeScript check passes. Broad existing suite was attempted: 1093 pass, 153 fail across 26 files, including Linux-only store locking on macOS and existing mixed node:test/Vitest discovery. Whole-project TypeScript also has pre-existing errors outside finance files. The same 47 focused tests also passed on Linux before the new release was activated.

Domain blocker: authoritative Porkbun DNS has no dashboard record and browser session requires owner login; no DNS API configuration found. New hostname TLS must wait for DNS. Existing authenticated /dashboard/finance remains usable after deployment.

## Deployed checkpoint

- Runtime release: `/home/ubuntu/releases/aio-dashboard-78f56d7`, source commit `78f56d7`. Preceding release `/home/ubuntu/releases/aio-dashboard-04e125b` is retained and its dependencies are reused because package-lock files match exactly.
- `aio-dashboard.service` is active. Existing environment, stores and automation settings are preserved.
- Authenticated HTML, finance snapshot and settings return 200. Snapshot returns both connected channels with no errors; the response contains only contract dates/prices, no buyer data. Unauthenticated finance API returns 403.
- Production browser verified real platform data and rendered all finance sections. Local fixture QA verified a sixth Spotify member creates a second account and reduces contribution after its extra cost. Mobile width 390 has no page overflow; tables scroll independently.
- Available now: `https://email-verify.one/dashboard/finance`. The existing browser administrator session works.
- `dashboard.jamkkangudok.com` has no authoritative A record as of this release; Porkbun is waiting for owner login. HTTP host bootstrap is staged for ACME only; admin login is not exposed over plaintext HTTP. After adding `dashboard A 43.155.153.165`, run `bash /home/ubuntu/finance-domain-ops/scripts/activate-finance-domain.sh` on the host to issue TLS and apply the committed final proxy.

## Follow-up review: famhead and custom hostname

The owner completed DNS. TLS issuance and nginx activation succeeded; verified HTTPS gives the expected 401 login and HTTP redirects to HTTPS. This resolves the earlier domain blocker.

Confirmed YouTube defaults: $6/account/month, 5 slots/account, monthly 15th shared billing, KRW 180/slot/day after platform fees before supplier cost. Review checked that existing and added slots use the same confirmed daily income without subtracting fees twice, existing expirations still apply, all accounts renew together on the 15th, dollar costs use an editable reference FX rate, and missing FX leaves profit unknown. The table explicitly labels post-fee income; it is not presented as gross sales. Legacy saved KRW settings preserve behavior. Three new model scenarios verify post-fee income, shared billing across two months, and missing/invalid FX.

## Annual run rate / FX follow-up

Reviewed annual income separately from expiring-contract forecasts: 365 days of today's income and fees, 12 months of recurring cost, retained account thresholds and unknown-cost handling preserved. Annual figures appear beside period figures in cards, service rows, totals and CSV. Model tests cover short remaining contracts, a sixth-member cost threshold, correct 12-month dollar costs and unknown costs.

FX review: new endpoint uses existing protected finance prefix, provider fetch is server-side, market quote timestamp and source are disclosed, fetches are coalesced and cached for 60 seconds, rates/timestamps are validated, old fallback quotes expire after seven days, delayed provider results are marked, and manual fallback/fixed settings are explicit. UI refresh cancels state writes after unmount. Exchange service tests cover cache/concurrency, refresh, failed-provider fallback, stale expiry and invalid quotes. Focused 58 tests and production build pass; finance UI/model/rate strict TypeScript check passes.
