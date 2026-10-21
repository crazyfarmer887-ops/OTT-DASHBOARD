# Disney numbered listing

- [x] Inspect existing inventory, listing, order, private chat and public access flows.
- [x] Add dedicated numbered Disney delivery and password-only buyer views.
- [x] Verify allocation/restart/refund/isolation, delivery idempotency, API persistence and both renderers; build and review.
- [x] Commit, push, deploy local source and verify production.
- [x] Register the requested account and publish one real six-place listing; verify seller page.

Pre-deploy: 109 targeted tests pass across ten suites; client build passes. Server type check retains existing diagnostics in chat/finance/Spotify modules and API index, with none in the changed modules. Self-review checked stable/refund/missing leases, legacy flow preservation, mailbox suppression in both renderers, no credentials in public copy, existing admin authentication, and no extra React effects or data fetches.

Production: committed release `ca38a48` built on the server and activated with all existing environment directives and shared data paths preserved. Service active with zero restarts; unauthenticated orders API 403. Authenticated dashboard verified six available places and new password-only numbering notice. Registered the user-supplied account through the existing UI and published exactly one listing, #17436, 150 KRW/day, six places, October 21–November 20 (provider displays 30 days). Seller page verified recruiting 0/6, period, price and approved description. Private journal read-back verifies registered state and `disney-numbered-password`; background sync advanced with no error. No synthetic buyer or chat was created. Screenshotted the real seller page in the chat workspace.

## Direct credential request follow-up

- [x] Inspect existing verified buyer `!` handler: it already covers numbered Disney leases and reads current credentials at request time.
- [x] Add Disney-specific private guide text offering `!`, without Netflix email-code guidance.
- [x] Verify the actual Disney poller/request/resolver, then commit/push/deploy and check runtime health.

Direct-request verification: 47 tests pass across four suites, including numbered Disney private-room isolation, one reply per buyer request, current credential changes on a later request, no plaintext credentials in the request journal, real resolver lease validation and refund denial. Client build passed. Release `e973aa5` pushed and deployed from the local Git archive; service active with zero restarts, deployed guide includes the `!` offer, production polling advanced and lastError remains null. Existing buyer for #17436 already had the old guide; sent the new non-secret usage notice once via the seller 1:1 UI and verified it in history. No synthetic buyer request or credential message was sent.

## Tinyhost email-code link

- [x] Implement explicit per-account Tinyhost setting, account-matched URL, both page renderers and revised fallback copy.
- [x] Verify identity checks, unconfigured accounts, existing consent and both rendered links; commit/push/deploy.
- [x] Enable only the requested account, verify its existing buyer access page and update the live listing's contradictory copy.

Tinyhost pre-deploy: 71 focused tests across six suites pass; client build passes. Review kept internal-mailbox validation and frame CSP unchanged, restricts Tinyhost to the explicitly enabled Disney account, requires matching mailbox path and login identity, opens a new tab without referrer, and preserves consent redaction.

Tinyhost production: release `3a41fae` built from pushed local Git source and activated, preserving all service environment/data paths. Enabled `emailAccessProvider=tinyhost` for only the requested account via authenticated existing account PATCH; private pre-change backup retained. Actual existing buyer access page now displays a matching `https://tinyhost.shop/<login-email>` new-tab link with `noreferrer`, without a PIN prompt. Opened the exact destination and verified the Tinyhost Inbox page. No mailbox contents or codes were needed. Seller listing #17436 now describes password sign-in as default and TV email-code fallback; original price/period/recruitment remain. Service active with zero restarts; polling has no error. Screenshot in the chat workspace shows the live link without exposing the password.
