# GButs MS Office supplier link delivery

## User request

Replace the Office email-request guide with direct Microsoft invitation delivery. The seller will add micro365.ren supply URLs in the dashboard. Allocate one supply item per paid buyer, obtain its aka.ms destination at purchase time, and send it privately once. Prevent source reuse and duplicate delivery, including across restarts; surface missing stock, supplier failures, expired invitations, and uncertain sends. Do not invent a buyer email or accept an invitation on anyone's behalf.

## Verified supplier behavior and unresolved input

- The supplied example URL is already issued. Its public page requests the email originally submitted, not a new invitation email. `POST /api/link/verify` verifies that exact email and sets a cookie, then the status page exposes an aka.ms anchor.
- The known email from the user screenshot successfully verified. The local TypeScript resolver read the real aka.ms link. Its redirect is Microsoft's `/family/accept-partner/shareable-link` path. No invitation was accepted.
- Activation status exposes the subscription end date, not the invitation issue/expiry time. Reading this page does not demonstrate regeneration or a fresh 48-hour window.
- Need an unused source link to observe the initial email submission endpoint, whether a particular email is required, and when invitation expiration begins. Do not guess this endpoint or submit made-up emails.

## Current implementation slice

- [x] Validate supplier URLs against exact HTTPS host/path; disallow cross-host redirects.
- [x] Parse only actual aka.ms anchors; reject ambiguous links, scripts and impersonation domains.
- [x] Support verified-email cookie flow without guessing/retrying mismatched email attempts.
- [x] Tests for these boundaries and live read of the provided issued link.
- [ ] Confirm unused-link generation/expiry semantics.
- [ ] Add dashboard stock input, atomic buyer allocation and durable direct-message reconciliation.
- [ ] Replace old guide after end-to-end review and release verification.

The resolver slice is local preparatory work. No deployment or change to active customer messages has been made by this slice.

## Resolver verification — 2026-10-11 KST

Focused tests: 7 passed. Full suite before the final parser-boundary regression: 1123 passed / existing 153 failures (no new failure group). Worker typecheck reports no supplier-module errors; existing unrelated type errors remain. Captured live authenticated status page parses successfully after the attribute-tokenizer correction. Standards and spec incremental review both found no blocking issue.
