# NBA password-login reliability

## Request and evidence (2026-10-26)

Check profile5 credentials against the owner-supplied password, strengthen ordinary interactive sign-in, and use the five rows in deliverables-1.txt only as spare accounts after a genuine account failure. Do not bulk replace working accounts or implement automatic spare replacement. Do not copy spare plaintext credentials into Git or monitor state.

Live source comparison found a different stored password (including after trimming). With that source password, native NBA sign-in displayed `Invalid email or password. Please try again.` and the input value matched the source exactly. A separate fresh sign-in with the owner-supplied password returned ok. Correct only the Linkid published password, preserve the account/party/members and all five spares, then verify live source and a real sign-in.

## Implementation

- [x] Fill visible email/password fields through normal keyboard events, replace old contents and verify exact DOM input values before submitting. Retry hydration/input loss at most once; never label an unverified submission invalid.
- [x] Prioritize access restriction, visible challenge/rate limit and transient service errors over credential wording. Credential errors must be visible, exact NBA rejection messages; ignore hidden/help text.
- [x] Require two independent fresh sign-ins with the same supplied credential to return invalid before reporting invalid. A different second result is unconfirmed/technical or success, never a confirmed bad password. No retries on rate limits/CAPTCHA limitations; no account resets or purchases.
- [x] Keep existing Steel/CapSolver isolation, cleanup and one task per attempt, hourly deduplication, failure-only alerts and private state. Allow enough oneshot time for five targets and at most two bounded sign-in attempts each.
- [x] Regression tests cover misclassification, input hydration/hidden controls, two-rejection confirmation and a transient first rejection followed by success.
- [x] Test/review, commit/push, deploy only the separate NBA monitor, smoke test current profile5 and preserve other services.

No automation can prove every technical failure means invalid credentials. Keep distinct verification, blocked, unavailable and unknown outcomes; only invalid has double explicit-rejection evidence.

## Operational correction

The owner-supplied password authenticated successfully. The Linkid editor initially appended to its existing value; that intermediate save was immediately corrected with a full replacement. A fresh private source read confirmed the final password digest exactly matches the supplied value. Party76784, profile5, existing email and membership were retained. No spare was consumed. No plaintext password is recorded here.

## Final validation

Local and production Linux:78focused tests passed. Build, isolated NBA TypeScript check, whitespace check and final diff review passed. Pushed runtime2f81a18 is deployed as nba-login-monitor-2f81a18. The corrected source credential authenticated through the deployed checker in102636ms, resultok, zero alerts. The real systemd invocation returned Resultsuccess/ExecMainStatus0; five active journal targets areok; hourly timer isactive. Main aio-dashboard PID588691 and private0600journal were preserved.
