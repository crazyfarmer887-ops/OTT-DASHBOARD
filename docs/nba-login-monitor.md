# NBA login monitor

## Request and behavior

Check the NBA accounts used by owned, active Linkid NBA parties every three hours, using fresh NBA password sign-ins. Send account action alerts to the existing Linkid Telegram topic. The supplier is Gamsgo; the current credentials published by the owner in Linkid are the operational source. Gamsgo account replacements must first be reflected in Linkid.

Separate systemd service and timer, independent of aio-dashboard: daily at 00/03/06/09/12/15/18/21 KST. Run once immediately on deployment. A restart does not itself trigger an extra credential attempt before three hours. Updated credentials are checked immediately. Shared credentials are checked once per run. No streaming, password changes, account recovery, global logout, CAPTCHA solving, or purchases.

An independent Linkid session reads owned service 2000 parties. `state=1` means open party; `mystate=8` means participating. Validate owner and party IDs before decoding credentials. Credentials remain in memory; the durable journal stores only a digest, result, timestamps and notification receipt. Files use mode 0600.

Results: explicit authenticated sign-out control with no password form = healthy; explicit wrong password/locked account = invalid; verification/challenge = verification required; network/browser failure = unavailable; insufficient evidence = unknown. A login redirect alone never counts as success. NBA ID login success does not prove premium playback or subscription status.

Failures are sent through `sendSellerAlert(provider='linkid')`, preserving existing bot and topic settings. Distinguish rejected credentials from verification/technical failures. Persist result before sending. Retry unconfirmed alerts on subsequent runs; suppress the same incident for 24 hours. A newly failed login after a healthy result starts a new incident. Source/state failures send a separate monitor-connection notice; never label an unverified account healthy.

## Deployment

Commit source, tests and these unit definitions. Archive committed source to a new release and symlink shared existing node_modules. Point `/home/ubuntu/nba-login-monitor-current` to it. Copy only the existing alert bot/chat/Linkid topic values to root-owned 0600 `/etc/graytag-secrets/nba-login-monitor.env`, plus `NBA_MONITOR_ENABLED=true`. Do not print secrets. Install units and start timer and service. Inspect a real completed run plus the next scheduled time. No aio-dashboard restart or drop-in change is needed.

Optional `NBA_CHROME_PATH`, `NBA_MONITOR_STATE_PATH`, and `LINKID_STORE_PATH`; the default browser is the installed official system Chrome (with sandbox), then the Puppeteer Chrome cache or system Chromium. Default state: the existing private dashboard data directory, `nba-login-monitor.json`. A host blocking automated login or requiring CAPTCHA must be reported as a monitoring limitation, not an invalid password. Never bypass protections.

## Verification

`npx vitest run tests/nba-login-monitor.test.ts tests/linkid-sync.test.ts alert-telegram.test.ts`; `npm run build`; `git diff --check`. These tests cover three-hour scheduling, fresh credential changes, durable deduplication, failed alert retry, incident recovery, redacted output, failure classification, shared credential checks, and Linkid credential decoding. Live server login and actual Telegram topic delivery must be checked separately; fixture tests alone do not prove them.
