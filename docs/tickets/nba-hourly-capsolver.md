# NBA hourly CAPTCHA processing via CapSolver

Spec: docs/nba-login-monitor.md, Hourly CapSolver integration section.
Base:35f5769.
Status: in progress.

- [x] Add bounded opt-in CAPTCHA processing to existing fresh-password checker.
- [x] Preserve hourly deduplication and notify only unresolved/failed accounts.
- [x] Tests/typecheck/build/full suite and two-axis review.
- [ ] Commit/push, isolated release and private environment configuration.
- [ ] Real checks, quiet success verification, timer/unit and unaffected dashboard verification.
