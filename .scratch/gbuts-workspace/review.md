# GButs workspace release review

Fixed point: cf4fd4c. Main change: 639f082. Query-navigation fix: 65848c0.

## Standards

No documented rule breaches or blocking correctness/security findings. New GButs GET routes inherit administrator authentication; overview excludes credentials; explicit GrayTag account headers and public buyer access remain intact. Optional repeated service registry in backend/frontend is consistent for the fixed five-service scope and deferred.

## Spec

One P2 query-navigation bug: service filter changes could retain the prior account/form. Fixed with Wouter query subscription, service-change reset, and account/filter validation. A React UI test verifies switching and clearing the filter without reloading inventory. Follow-up spec review confirmed resolution.

Summary: Standards 0 blocking findings, 1 optional smell; Spec 1 finding resolved, 0 outstanding.

Production verification follow-up: narrow-screen control overlap fixed and closed drawer marked inert. Inventory browsing now reuses the existing verified snapshot with stale status/time; publication/fulfillment retain fresh reads. Separate regression proves fresh-read failure sends no publication. Follow-up spec review found no new issue. Final targeted tests: 10 files, 59 passed; build and changed UI type checks passed.

Canonical HTML routes now share the existing password gate after Nginx prefix stripping, including trailing slashes. Session regression tests cover all GButs/Spotify paths and preserve public buyer access.

Live sales-form check found generic `(직접전달)` account placeholders in the existing management data. These now have zero sellable inventory, alongside empty/notice credentials, so service cards preselect real account identifiers. Shared-capacity regression covers all three cases.

Final production release: 07a098b. Standards follow-up findings (HTML trailing slash guard and placeholder eligibility) resolved and reviewer confirmed no blockers. Browser verified genuine filtered accounts and completed both existing-account transitions; home and order APIs healthy. See ticket for operational cold-read latency and baseline test failures.
