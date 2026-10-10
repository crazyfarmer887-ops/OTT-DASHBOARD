# Finance review against 90c1e4e

Standards: local existing repository used; private file outside release; no credentials or customer identifiers returned; admin-protected reads and writes; Hono/React patterns retained; Tailwind v4 global CSS preserved with scoped finance overrides. React review checked derived calculations, direct icon imports, no extra chart dependency, labeled controls, modal focus trapping/Escape, responsive overflow and reduced motion.

Spec: separate BUTS and YouTube-only Graytag; confirmed active contract filters; existing expirations; member sliders and account thresholds; cost periods and retained paid capacity; upfront new-unit payments; monthly clamped dates; amortized contribution separate from cash flow; CSVs; stored assumptions and private host routing. Unknown supplier amounts/date retained explicitly, not fabricated. Bank deposits are modeled assumptions, not asserted actuals.

Review fixes: removed optimistic high-price contract selection when reducing members; reduction scales existing earnings proportionally. Default retained accounts reflect current party count. New accounts charge upfront today. Empty successfully read services differ from failed platforms. Root width explicitly overrides old mobile-only dashboard styling. Icon-only narrow sidebar buttons retain accessible labels. Login return path preserves finance view without allowing arbitrary redirects.

Verification: 47 focused tests pass (model, API, admin auth, session, server auth and GButs overview); Vite build passes; isolated finance UI/model strict TypeScript check passes. Broad existing suite was attempted: 1093 pass, 153 fail across 26 files, including Linux-only store locking on macOS and existing mixed node:test/Vitest discovery. Whole-project TypeScript also has pre-existing errors outside finance files. Release runs focused tests again on Linux.

Domain blocker: authoritative Porkbun DNS has no dashboard record and browser session requires owner login; no DNS API configuration found. New hostname TLS must wait for DNS. Existing authenticated /dashboard/finance remains usable after deployment.
