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
