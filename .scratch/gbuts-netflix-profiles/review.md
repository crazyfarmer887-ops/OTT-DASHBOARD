# GButs Netflix release review

Fixed point: a6071c0. Implementation: a9f2ba6, e7fae5b, d272403.

## Standards
No documented hard violations. Fixed missing recruiting IDs silently deduplicating separate occupied numbers. Fixed manual edits validating stale profiles: proposed members and runtime inventory now use the same exact account-bound access-record resolver. Final reviewer found no remaining concrete blockers. Primitive-number domain type was a nonblocking heuristic suggestion.

## Spec
Fixed the actual standalone public renderer (not only the React fallback), released/reactivated buyer access, serialized manual occupancy checks and isolation of Netflix allocation errors per account. Final reviewer found no remaining concrete blockers.

## Verification
10 relevant suites / 101 tests pass, including actual access GET/consent and periodic refresh denying a released buyer, real manual POST rejecting occupied profiles, public HTML execution through consent, compact credentials and strict email-origin filtering. Full local suite: 1022 pass / 153 known preexisting failures; no additional failures. Build passes. App type check has the same 54 preexisting diagnostic lines and none in changed files.

Browser verification used fake buyer credentials with the production public renderer and its actual CSP. The embedded existing email page displayed its PIN prompt; no PIN bypass or real messages/listings/accounts were created. Production initially has zero bound GButs OTT orders/listings, so no Netflix buyer migration is required.

## Deployment
Release 0ac5924 was pushed, archived from Git and built on the server before restart. aio-dashboard.service is active on the new release. Authenticated orders/overview/inventory routes return200; unauthenticated admin API403 and admin HTML401; the actual public HTML200 carries the strict frame CSP and unknown access API404. GButs polling remains enabled and original storage/environment paths are preserved. Browser verified the approved listing template, fixed-profile notice and GButs-specific five-free-place Netflix account selection. No external listing or buyer message was issued. First cold inventory read took27.6seconds; it completed successfully with61accounts.
