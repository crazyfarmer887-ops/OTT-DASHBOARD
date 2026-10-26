# NBA login monitor

## Request and behavior

Check the NBA accounts used by owned, active Linkid NBA parties every hour, using fresh NBA password sign-ins. Send account action alerts to the existing Linkid Telegram topic. The supplier is Gamsgo; the current credentials published by the owner in Linkid are the operational source. Gamsgo account replacements must first be reflected in Linkid.

Separate systemd service and timer, independent of aio-dashboard: daily at every hour on the hour in KST. Run once immediately on deployment. Checks are deduplicated per hourly calendar slot so a small runtime delay cannot skip the next slot. A restart in the same slot does not trigger another credential attempt. The immediate deployment check can be closer to the next scheduled slot. Updated credentials are checked immediately. Shared credentials are checked once per run. No streaming, password changes, account recovery, global logout, CAPTCHA solving, or purchases.

An independent Linkid session reads owned service 2000 parties. `state=1` means open party; `mystate=8` means participating. Validate owner and party IDs before decoding credentials. Credentials remain in memory; the durable journal stores only a digest, result, timestamps and notification receipt. Files use mode 0600.

Results: explicit authenticated sign-out control, or the canonical NBA profile page with a visible MY ACCOUNT heading and the exact expected email, with no password form = healthy; HTTP403/Access Denied = server access blocked; explicit wrong password/locked account = invalid; verification/challenge = verification required; network/browser failure = unavailable; insufficient evidence = unknown. A login redirect alone never counts as success. NBA ID login success does not prove premium playback or subscription status.

Failures are sent through `sendSellerAlert(provider='linkid')`, preserving existing bot and topic settings. Distinguish rejected credentials from verification/technical failures. Persist result before sending. Retry unconfirmed alerts on subsequent runs; suppress duplicate notices within the same hourly slot; repeat a persistent failure once in each newly checked hourly slot. A newly failed login after a healthy result starts a new incident. Source/state failures send a separate monitor-connection notice; never label an unverified account healthy.

## Deployment

Commit source, tests and these unit definitions. Archive committed source to a new release and symlink shared existing node_modules. Point `/home/ubuntu/nba-login-monitor-current` to it. Copy only the existing alert bot/chat/Linkid topic values to root-owned 0600 `/etc/graytag-secrets/nba-login-monitor.env`, plus `NBA_MONITOR_ENABLED=true`. Do not print secrets. The host must have Xvfb/xauth and official Chrome installed. The oneshot runs rendered Chrome inside xvfb-run with the browser sandbox enabled. Install units and start timer and service. Inspect a real completed run plus the next scheduled time. No aio-dashboard restart or drop-in change is needed.

Optional `NBA_CHROME_PATH`, `NBA_MONITOR_STATE_PATH`, and `LINKID_STORE_PATH`; the default browser is the installed official system Chrome (with sandbox), then the Puppeteer Chrome cache or system Chromium. Default state: the existing private dashboard data directory, `nba-login-monitor.json`. A host blocking automated login or requiring CAPTCHA must be reported as a monitoring limitation, not an invalid password. Never bypass protections.

## Verification

`npx vitest run tests/nba-login-monitor.test.ts tests/linkid-sync.test.ts alert-telegram.test.ts`; `npm run build`; `git diff --check`. These tests cover hourly scheduling, fresh credential changes, durable deduplication, failed alert retry, incident recovery, redacted output, failure classification, shared credential checks, and Linkid credential decoding. Live server login and actual Telegram topic delivery must be checked separately; fixture tests alone do not prove them.

## Initial production verification — 2026-10-23 KST

Three owned, active NBA parties discovered; official installed system Chrome launches with its sandbox enabled. Initial real NBA checks reached a server access restriction and all three results were `verification`, never healthy or invalid-password. All three Linkid-topic action notifications were acknowledged by the existing Telegram sender and persisted. The oneshot service completed with exit 0; the timer is enabled/active. Actual successful authentication remains unverified because NBA is restricting this server. The monitor reports that limitation and retries on its next regular slot; it does not bypass CAPTCHA or access protections.

Separate release symlink `/home/ubuntu/nba-login-monitor-current`; systemd units `nba-login-monitor.service` and `.timer`. The aio-dashboard process/release is unchanged. Focused tests: 34 passed; isolated monitor typecheck, client build, and diff whitespace check passed.

## Hourly recovery request — October 26

The owner requests a fresh sign-in every hour, every day, and a Telegram failure notice. Preserve the existing owned Linkid NBA party source, separate service, shared-credential deduplication and private state. The supplied test account matches the current second-profile NBA party; do not save a second credential source or change Linkid credentials.

Use the established login-check and scheduled-monitor seams. Verify a new hourly slot runs even if a previous check finished late, no duplicate check/notice within a slot, retry failed Telegram sends, and redact passwords from notices/state. Repeated failed hourly checks should produce one failure notice per hourly slot, while successful checks remain quiet. Distinguish server access denial from wrong credentials and additional verification. Never treat a cached browser session or a redirect as a successful fresh password login.

Live reproduction: the deployed headless checker returns verification before submitting credentials. Both the sign-in document and homepage return HTTP403 Access Denied. The same installed browser rendered normally under the installed virtual display reaches HTTP200 with the email form; waiting for network readiness allows the email-to-password progression; DOMContentLoaded alone can race the hydrated form. The user's existing Chrome session shows the supplied account and an active Season-Long League Pass, which alone does not verify its password.

Use normal supported browser navigation. Do not disable browser security, conceal automation, solve CAPTCHA, reset passwords, purchase, or assume an upstream denial proves bad credentials. Deploy only committed local source, verify the timer and real failure delivery separately, and leave aio-dashboard and unrelated automation unchanged.


## Recovery verification — 2026-10-26 KST

The old checker reproduced HTTP403 before credential submission. Rendered Chrome under Xvfb reaches the ordinary sign-in form; network readiness avoids racing the email form. A second runtime defect was a tsx-injected external `__name` helper inside the serialized page callback. The observer now uses self-contained browser DOM calls. A hidden optional consent button is not clicked.

The corrected candidate, loaded from a temporary diagnostic directory without editing the deployed release, completed a fresh isolated password sign-in for the requested account in 15,318ms and returned `ok`. This used the current owner-published Linkid credentials, rather than the user's cached Chrome session. No credential, session cookie, or full page dump was saved. NBA ID login is the scope of this check; streaming entitlement is not tested.

Focused monitor/Linkid/Telegram tests: 36 passed. Monitor TypeScript check, client build and whitespace check passed. Full suite: 1,345 passed, 153 failed across existing unrelated tests (the same pre-existing failure count); none of the focused tests fail. Standards and Spec review completed; the cookie-visibility finding was fixed and re-reviewed. Committed deployment and actual scheduled-run/Telegram verification follow separately.


### Final diagnosis and operational scope

A later full production check produced one ok and two unknown results. The initial candidate success did not establish reliable unattended login. Further live inspection confirmed two visible Sign In buttons; the old fallback could click the navigation control. The corrected helper selects only the nearest password-panel submit, excludes navigation, and refuses ambiguous or missing matches. The second password step waits for network readiness before a native click.

The remaining blocker is NBA's own CAPTCHA: the requested test account's server assessment returned score 0. NBA's public client uses a configured threshold (default0.5) and switches to the human-checkbox flow on failure. The real page showed a visible normal-size reCAPTCHA checkbox, an invisible enterprise badge, and a hidden challenge frame. The prior observer detected only challenge frames, so it missed the required checkbox. The corrected observer marks the visible checkbox as verification, without treating the passive badge or an HTTP200 assessment alone as a challenge. It does not solve or bypass the checkbox. Ordinary cookie consent was tested in a disposable context and did not remove the blocker; production continues to reject optional tracking cookies.

Hourly monitoring and Telegram delivery are repaired; fully unattended password authentication remains restricted by NBA's human verification. A failed security assessment is not evidence of a wrong password. Do not report complete login recovery. An explicit forceCheck option permits one administrative deployment validation without changing historical state or the normal hourly deduplication; unchanged same-slot failure alerts still remain deduplicated.

A real Telegram connection-test message was acknowledged through the existing Linkid topic with dry-run disabled. The first production run also persisted delivery receipts for both inconclusive accounts. The aio-dashboard service and its deployment were untouched. Final focused tests include duplicate-label selection, fail-closed missing/ambiguous submit controls, isolated page callback execution, visible checkbox versus passive badge, and explicit deployment-check deduplication.


### Deployed validation — 2026-10-26 KST

Runtime release `/home/ubuntu/releases/nba-login-monitor-96971cc` is built from pushed commit96971cc; the previous recovery release7a3af3b is superseded. Archive SHA256: b957f5f58fb9b8d4faee7ad8ba9547f71c2fc5cb1c37ebdf8eeeb7ff8e8f14dd. Existing shared dependencies matched the lockfile before linking. The installed service uses Xvfb; hourly timer is enabled/active and next fires at12:00KST onOctober26.

One explicit post-deployment forceCheck completed with exit0. All three current owned NBA parties75851/76513/76659 returned verification, and each had a confirmed Telegram delivery receipt for the new result. The historical retired party record was preserved. The state file remains0600. No password or token is in the monitor journal. Actual failure delivery and the separately labelled connection test both succeeded. The final checker reports the human-verification blocker accurately; unattended authentication is not claimed to be fixed.

Final focused tests:39passed. Monitor and test TypeScript check, client build, whitespace check, Standards and Spec re-review passed. The earlier full suite retained153existing unrelated failures; no additional full-suite rerun was needed after the final focused regressions. No code/settings of aio-dashboard were modified or restarted.


## Steel browser provider — October 26 request

Use Steel.dev for the existing hourly fresh-password check. Keep the owned Linkid target source, result classification, journal, hourly deduplication and existing Telegram topic. Select explicitly with `NBA_BROWSER_PROVIDER=steel` and root-private `STEEL_API_KEY`; the default remains `local` for existing deployments. A selected Steel failure must report unavailable, never silently retry through local Chrome or mark credentials invalid. An existing project-scoped Steel key was found in the established jamkkangudok runtime; authentication returned HTTP200 without creating or rotating a key. Copy it privately to the NBA monitor environment for activation.

Create one isolated, short-lived Steel session for each checked credential and use Puppeteer CDP for the same password flow. Bound creation, WebSocket handshake and CDP attachment, and session lifetime; terminate the socket on attachment timeout; release only the session created for this check on every exit, including failed connection and ambiguous creation. Disable proxy, CAPTCHA solving, fingerprint injection, interaction simulation and persisted profiles. Additional NBA verification remains a separate result. Do not expose keys, CDP/viewer URLs, passwords, browser state or response bodies in logs. Do not add saved credentials or profiles to Steel.

Verify at the existing checkNbaLogin seam using mocked external browser/HTTP boundaries: fresh password submission and authenticated evidence, blocked/verification results, provider failures, cleanup and no fallback. Keep existing hourly alert tests. Review against this section, commit/push and deploy only the independent NBA monitor release. Actual Steel authentication and Telegram delivery must be verified separately with the current owner-published test account, after a key is available. Do not restart aio-dashboard.

Steel verification:53focused tests and isolated TypeScript checks passed. A real stalled HTTP upgrade test confirms the transport closes and releases its owned session. Use the pinned ws8.22.0 dependency (not an older shared installation). The final full suite has1365passes/153existing unrelated failures, and the client build and two-axis re-review pass. Live activation follows separately.


### Steel deployment verification — 2026-10-26 KST

Pushed runtime commit6912a83, deployed independently to `/home/ubuntu/releases/nba-login-monitor-6912a83`; the current NBA release symlink points there. Committed archive SHA256:7bdf69fad3f7b1dc29f9a9b6ae061c7e2df464c77160e54d6c504e0489582ac8. Pinned ws8.22.0 package integrity was checked against the committed lockfile before creating a private dependency overlay; other shared dependencies were reused without modification.

The already established jamkkangudok project key authenticated successfully and was copied privately to root-owned0600NBA environment, with `NBA_BROWSER_PROVIDER=steel`. No key was created, rotated or printed. The prior environment and journal were backed up privately. The original journal location, all historical records, bot/chat/topic, lock, hourly timer and unit remain unchanged. No aio-dashboard restart: its main PID remained588691 throughout verification.

An initial fresh test-account check returned verification in49.7seconds. The explicit three-target production monitor check returned ok for active parties75851and76659; party76513(the supplied test account) returned verification. This establishes fresh password login for two accounts in this run, not reliable unrestricted authentication for every account. The checker leaves NBA's additional security challenge unresolved and distinguishes it from rejected credentials. All three production sessions had acknowledged creationHTTP201and scoped releaseHTTP200.

The current test-account failure had already been notified in the same hourly slot, so its existing confirmed receipt was retained and the deployment check did not send a duplicate message. Successes remained quiet. Telegram dry-run is disabled and existing destination configuration is present. The retired76552record is unchanged; four historical/current journal rows remain, with three current active targets. State permissions remain0600.

Mac and production Linux focused verification:53tests passed. Final full suite:1365passed/153existing unrelated failures; isolated TypeScript, build, diff check and both Standards/Spec re-review passed. The actual service invocation and timer verification are recorded below.

Actual `nba-login-monitor.service` invocation completed successfully (Result=success, ExecMainStatus=0); the same-slot run reused the just-checked results, avoiding extra login attempts/alerts. The enabled/active timer next fires October26at16:00KST (displayed as15:00CST on the host). The dashboard remained active at the same PID.


### Opt-in built-in CAPTCHA experiment — 2026-10-26 KST

The owner explicitly requested enabling Steel's built-in automatic CAPTCHA handling for one fresh sign-in test of the supplied second-profile NBA account. This supersedes the earlier no-solving constraint for this isolated experiment only. A local operational harness reused the committed browser lifetime/cleanup and login helpers, requested `solveCaptcha=true` with a bounded300-second session, and prepared bounded CAPTCHA-status polling and explicit NBA authentication validation. No runtime source, hourly configuration, password, cached session or journal was changed.

The real session-create request returnedHTTP403 before any NBA login attempt: Launch requires at leastUSD10in paid balance for CAPTCHA solving. No browser session was created; scoped cleanup of the allocated ID returned404as expected. The existing key remains valid for ordinary Steel sessions. The account's Wallet UI separately confirms included creditsUSD24.35and purchased creditsUSD0.00, no payment method and no purchase history. Included credits do not satisfy this API gate.

Live CAPTCHA-assisted NBA login remains untested because paid credits are required. No credits were purchased, card added, plan upgraded, or billing gate bypassed. The original timer remains active and the NBA runtime remains6912a83; aio-dashboard stays active at the originalPID588691. The Wallet page was opened for owner action. The operational script and redacted result receipt are preserved in the calling task's `artifacts/nba-steel-captcha-test-20261026/` directory.


### CapSolver-assisted fresh login test — 2026-10-26 KST

The owner explicitly requested CapSolver API processing for the same supplied test account after Steel's built-in solver hit its paid-balance gate. The old running application's CapSolver value was invalid; the owner supplied a valid existing account key. It was used only in the isolated child's environment and never saved in source, the NBA environment file, journal, result receipt or logs. The CapSolver connection returnedHTTP200/errorId0, with reported balanceUSD4.3345.

An isolated operational harness reused the committed Steel lifetime/cleanup and NBA login helpers, with Steel solving disabled and a300-second owned session. In a fresh private browser context it submitted the current owner-published credentials, observed the real normal-size reCAPTCHA v2 checkbox, and created exactly one ReCaptchaV2TaskProxyLess task. Only challenge metadata was sent to CapSolver, without the NBA password or account cookies. The resulting token stayed in memory and was delivered to the uniquely matching v2 callback; the password-panel submit was then clicked normally.

Live result:okafter121510milliseconds. The NBA account page displayed the expected test-account email and MY ACCOUNT heading; both password form and visible challenge were absent. CapSolver token issuance alone was not treated as success. Steel session creation returned201and scoped release returned200. The redacted receipt and operational harness are in the calling workspace's artifacts/nba-capsolver-test-20261026 directory.

This is one successful explicit test, not a recurring integration or a guarantee of every later attempt. No production source/configuration, hourly journal, timer or alert destination was modified. The existing hourly monitor still does not invoke CapSolver. A recurring integration is a separate implementation step if requested.


## Hourly CapSolver integration — October26 request

The owner now requests CapSolver processing in the regular hourly checks, followed by Telegram alerts only for accounts whose login fails or cannot be confirmed after processing. This supersedes the previous no-solving/test-only limits for owned current NBA parties. Continue using fresh owner-published Linkid credentials, Steel private contexts, the existing hourly timer/lock/state and Linkid Telegram destination. Successful sign-ins, successful CAPTCHA processing and connection-test notices stay quiet. Source/state load failures are operational errors in the service log, without an account-failure Telegram claim.

Enable via `NBA_CAPSOLVER_ENABLED=true` and root-private `CAPSOLVER_API_KEY`. Steel built-in solving stays off. Only a visible normal-size Google reCAPTCHA v2 (including the supported enterprise variant) on the canonical NBA sign-in page is eligible; a passive invisible badge, verification-code prompt or rate-limit screen does not create a solver task. At most one paid task per credential check. Send only the public challenge metadata, no NBA credentials or account cookies. Bound task polling to120seconds, keep the owned browser alive during it, and use a300-second Steel session when enabled. Allow20minutes for the three-target oneshot; keep the hourly calendar and shared lock unchanged.

After a valid solution, call only the uniquely matching v2 callback, submit the relevant form normally if needed, and verify actual NBA authenticated evidence. A ready token is not login success. Callback ambiguity, failed/expired tasks, missing/invalid key or remaining challenges produce an unconfirmed-login result, never a bad-password claim. Never print or persist provider keys, tokens, browser state or full API error bodies. Close/release owned sessions on every result. Keep shared-credential checks and hourly failure-notice deduplication.

Verify at the existing checkNbaLogin and monitorNba boundaries, including real browser callback serialization, success after CAPTCHA, all-success quiet behavior, mixed success/failure account alerts, no-task passive badges, bounded provider failure/timeout and one-task cleanup. Review, commit/push, deploy the isolated NBA release and privately install the existing owner-supplied key. Run an explicit real three-account check and a same-slot service invocation; only actual failures may send Telegram messages. Preserve aio-dashboard and GButs renewal/sync behavior.

Hourly integration validation before deployment:69focused tests and isolated TypeScript checks pass; build passes. Final full suite retains153existing unrelated failures, with1381passes. Both Standards and Spec reviews pass after fixing a keepalive operation that could exceed the120-second solver deadline; a stalled-CDP regression verifies bounded cleanup. The browser callbacks are exercised in isolated DOM VM contexts.


### Hourly CapSolver production verification — 2026-10-26 KST

Runtime commitb4b7904was pushed and archived to the independent release `/home/ubuntu/releases/nba-login-monitor-b4b7904`; archiveSHA256is6bf1d68ee83326e91122cfc8fa7b307da6df7f14f9560131c7c0359baf475139. The unchanged dependency lockfile was verified before reusing the previous NBA release's pinned dependency overlay. Mac and production Linux each passed69focused tests; final full suite:1381passes/153existing unrelated failures. Isolated TypeScript, build, whitespace checks and both review axes pass.

The owner-provided CapSolver key was privately installed in the existing root-owned0600NBA environment, with NBA_CAPSOLVER_ENABLED=true and NBA_BROWSER_PROVIDER=steel. Steel built-in solving stays off. Previous environment, journal and unit were backed up; existing timer/lock/destination/history were retained. A newline serialization error in the first environment write was detected by post-deploy configuration validation and corrected from the backup before running any check. The verified final environment contains proper physical lines and was parsed successfully by the actual service.

An explicit forceCheck through the deployed runtime completed all three active owned accounts: crazyfarmer887@gmail.com=ok(60326ms), iri00001@gmail.com=ok(53230ms), yozyzsss@gmail.com=ok(73585ms). The run created exactly one CapSolver task and received one ready token, with no provider errors. All three owned Steel sessions had201creation and200release acknowledgements. There were zero alert calls: successful sign-ins and CAPTCHA processing remained quiet, without sending a test/connection notice.

The live journal's three active parties75851/76513/76659are all ok. The retired76552record is unchanged, four journal rows remain and file mode is0600. The subsequent actual systemd service invocation succeeded with exit0and reused the same-slot results. Installed unit bytes match committed source, with a20-minute process limit. The timer is enabled/active and next fires October26at18:00KST (17:00CST on the host).

The separate aio-dashboard service remained atPID588691. Its16GButs renewal policies remain enabled, safeModefalse and no global renewal error. No dashboard process, sales listing, buyer message, profile or renewal setting was modified. Deployment receipt: calling workspace artifacts/nba-hourly-capsolver-20261026/deployment.json.


## 2026-10-26 reliability follow-up

Profile5's initially rejected check used a different password published in Linkid. Private comparison (including trimming) did not match the owner-supplied value. Native NBA submission verified exact input contents and returned the explicit message `Invalid email or password. Please try again.`. A separate fresh sign-in with the owner-supplied value succeeded. The Linkid stored password was corrected and re-read privately to confirm an exact match. The five accounts in the supplied file are untouched spares; working accounts must not be bulk replaced.

The reliability change follows `docs/tickets/nba-login-reliability.md`: ordinary visible-field replacement with keyboard events and exact value verification, one bounded hydration refill, visible exact rejection messages, security/technical precedence, and a second independent native sign-in before an invalid result. Password submission is required before rejection can count; CAPTCHA resubmission re-verifies the password. Never treat pre-submission copy, hidden fields/help or a single transient rejection as confirmed invalid. Verification, blocked, unavailable and unknown remain distinct unconfirmed outcomes; zero-error classification cannot be promised.

The maximum two owned300-second sessions per credential and five current targets require a55-minute oneshot ceiling; the existing hourly timer and non-blocking global lock remain unchanged. Each individual attempt keeps its existing bounded Steel lifetime and single CapSolver task. No automatic spare replacement was added.
