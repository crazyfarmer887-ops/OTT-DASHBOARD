# NBA hourly login and failure-notification recovery

Blocked by: None.
Status: in-progress.
Spec: docs/nba-login-monitor.md, Hourly recovery request — October 26.

- [x] Reproduce deployed failure and distinguish the actual failing login stage.
- [x] Use a normal rendered server browser for the supported sign-in flow; verify fresh password authentication or document the exact upstream blocker.
- [x] Check every hourly calendar slot; suppress duplicate checks and failure notices within that slot, retry unconfirmed notices, and remain quiet on success.
- [x] Preserve private credentials, existing party source, state and Telegram Linkid topic.
- [ ] Tests/review, commit/push, isolated monitor deployment, timer and live Telegram verification.

Existing deployed checker red reproduction: expected ok, actual verification in1849ms for the owner-supplied test account. Public document probe reproduces HTTP403 on both NBA sign-in and homepage. Rendered browser probe reaches HTTP200 without security overrides.

Candidate live test: fresh isolated password login returned ok in15,318ms. Additional cause: tsx-injected __name in serialized DOM observer. Fixed readiness, self-contained observer, hidden consent handling, hourly timer and result classification. Focused36pass; build/typecheck/diffcheckpass. Fullsuite1345pass/153pre-existingfail. Standards finding fixed and re-reviewed; Spec0findings.

Finaldiagnosis: scopedsubmitbugfixed; NBAreCAPTCHAv3score0switchestohumancheckbox. Correctlyclassifyverification, do not claim fullunattendedloginrecovery. Addednormalcheckboxvsbadge regression andexplicitdeploymentforceCheck preservinghistory/dedup. ExistingTelegramrealtestacknowledged; finalreleasevalidationpending.
