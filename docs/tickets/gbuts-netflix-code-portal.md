# Netflix bot code portal

Spec: ../gbuts-netflix-code-portal.md

- [x] Implement scoped portal registry, authorization, serialized bot bridge and safe public API/UI.
- [x] Add one-time existing/future buyer link/PIN/image onboarding and retire confirmed legacy code chat replies.
- [x] Capture actual portal screenshots, upload the guide and pin its asset.
- [x] Verify tests/build/security, commit/push and deploy the isolated app/routes.
- [x] Deliver once to eligible existing buyers, verify history and future worker; Telegram errors only.

Release `eb41424` deployed 2026-10-29 with onboarding initially disabled. Both eligible existing buyers passed live PIN and account-binding checks; cross-buyer session isolation was checked. After activation, both text and image receipts were confirmed in the respective buyer chats. The focused suite passed 163 tests across 15 files; the additional assignment-change regression and the code tests passed. The Vite build succeeded. Supplier lookups are covered by mocked tests; no live code request was generated for testing.
