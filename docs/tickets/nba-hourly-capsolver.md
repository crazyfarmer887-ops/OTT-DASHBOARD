# NBA hourly CAPTCHA processing via CapSolver

Spec: docs/nba-login-monitor.md, Hourly CapSolver integration section.
Base:35f5769.
Status: shipped throughb4b7904; all three real active accounts passed, one CAPTCHA processed and no Telegram alerts sent.

- [x] Add bounded opt-in CAPTCHA processing to existing fresh-password checker.
- [x] Preserve hourly deduplication and notify only unresolved/failed accounts.
- [x] Tests/typecheck/build/full suite and two-axis review.
- [x] Commit/push, isolated release and private environment configuration.
- [x] Real checks, quiet success verification, timer/unit and unaffected dashboard verification.

Standards review: solver keepalive deadline finding fixed and re-reviewed; no remaining findings.
Spec review: same deadline finding fixed and re-reviewed; no remaining findings.
