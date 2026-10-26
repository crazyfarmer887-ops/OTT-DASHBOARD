# NBA login checks through Steel.dev

Spec: docs/nba-login-monitor.md, Steel browser provider section.
Status: shipped through6912a83; real test-account result is NBA additional verification, while the other two current accounts signed in successfully.

- [x] Inspect current checker/runtime and official Steel lifecycle/authentication docs.
- [x] Implement explicit provider with isolated sessions, bounded lifetime and reliable cleanup.
- [x] Test fresh sign-in, failure classification, privacy and no silent fallback.
- [x] Typecheck, full suite and two-axis review.
- [x] Commit/push and deploy.
- [x] Configure root-private Steel key, deploy independent monitor and verify real test-account result.
- [x] Verify actual service invocation and hourly timer.

Official references: https://docs.steel.dev/overview/authentication, https://docs.steel.dev/overview/sessions-api/configuration, https://docs.steel.dev/overview/sessions-api/session-lifecycle, https://docs.steel.dev/integrations/puppeteer.


## Follow-up: built-in CAPTCHA test

- [x] Owner authorized one-account test using Steel automatic CAPTCHA handling.
- [x] Request an isolated solving-enabled session and record the actual response.
- [x] Confirm theHTTP403paid-credit gate against Wallet balances; preserve production monitoring.
- [ ] Owner supplies at leastUSD10paid balance (or otherwise enables eligible CAPTCHA access); then repeat the real fresh-login test.

This experiment did not reach NBA login and is not evidence of invalid credentials or solver failure. No source/configuration rollout was made.


## Follow-up: CapSolver API test

- [x] Owner authorized using CapSolver and supplied a valid key after the old environment value proved invalid.
- [x] Execute one real v2 task in a fresh owned Steel session; keep credentials/tokens private.
- [x] Verify actual expected-account authentication after token application and native password submit.
- [x] Release the owned session and preserve existing monitoring configuration/journal.

Result: requested test account successfully signed in; elapsed121510ms. CapSolver-assisted hourly operation has not been requested/applied in this test.
