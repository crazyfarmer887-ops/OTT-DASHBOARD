# NBA hourly login and failure-notification recovery

Status: monitoring and alerts shipped; unattended authentication restricted by NBA human CAPTCHA.
Spec: docs/nba-login-monitor.md.

- [x] Reproduce the deployed failure and identify its stage.
- [x] Restore a rendered server browser with the sandbox enabled; distinguish access denial from bad credentials.
- [x] Fix page readiness, serialized observer helper and duplicate Sign In button selection.
- [x] Detect the required visible CAPTCHA checkbox without treating the passive badge as a challenge.
- [x] Check every hourly calendar slot and notify each failed check once; retry unconfirmed delivery and stay quiet on success.
- [x] Preserve existing Linkid credential source, historical state, Telegram topic and unrelated dashboard process.
- [x] Tests, two-axis review, commits/push, isolated release deployment, timer and real Telegram verification.
- [ ] Fully unattended authentication: NBA currently returns a score0 assessment and requires a human checkbox. No CAPTCHA solving or bypass was performed.

## Evidence

The original headless checker returned HTTP403 before submitting credentials. A normally rendered browser reached HTTP200. A tsx-injected external __name helper broke page observation; the observer is now self-contained. The page has two visible Sign In buttons; the submit finder now scopes to the password panel and refuses ambiguous/missing matches.

An early candidate returned ok once, but a later full run had one ok and two unknown. This did not establish reliable unattended authentication. Further live inspection confirmed the supplied test account's CAPTCHA score0 and a visible normal-size checkbox. The final checker distinguishes this explicit verification requirement from rejected credentials.

Pushed runtime commits:7a3af3b,96971cc. Deployed release: nba-login-monitor-96971cc. Final explicit fresh validation: all3current parties returned verification; all3notification receipts confirmed. The normal hourly timer is enabled/active. A separately labelled Telegram connection test was acknowledged with dry-run disabled.

Final validation:39focused tests passed; source/test typecheck, client build and whitespace check passed. Standards/Spec findings were fixed and re-reviewed. The earlier full suite had1345passes/153pre-existing unrelated failures. See the spec for release checksum and operational detail.
