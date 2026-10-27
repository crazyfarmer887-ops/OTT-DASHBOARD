# Codex status checks → server Hermes and Kilo

The active Codex Google-family monitor (five minutes) and subscription-rank monitor (hourly) move to Hermes cron on the existing operations server. Existing AIO rank workers, Google sender timer and NBA login timer remain the actual executors. The three already-paused Codex tasks and the existing paused Hermes task remain paused.

`deploy/hermes_ops` is the versioned source. Deploy an exact committed archive inside `~/.hermes/scripts/`; Hermes requires scripts to resolve inside that directory. Run `install.py` using the installed Hermes venv. It backs up configuration and job storage, adds the named `custom:kilo` provider and creates paused, per-job-pinned monitors. The main chat provider is preserved.

Each monitor is a no-agent script: healthy or unchanged checks emit `[SILENT]`, invoking neither an LLM nor Telegram. The deterministic checker can call only the existing authenticated renewal queue once per overdue service, respecting pause/safe mode and excluding the read-only generic-policy copies from the OTT path. It never directly creates/closes posts, edits policy settings, sends invitations, restarts services or reads browser sessions.

Only changed alerts are summarized via `kilo-auto/free`, using a newly rebuilt allowlist of event codes, service labels and counts. Raw policies, buyer data, credentials, bot tokens, cookies, API responses and logs never go to Kilo. Anonymous requests need no paid key; a free-router error never falls back to a paid model and never suppresses the deterministic alert. This also keeps existing confidential Hermes chat context out of free-model requests.

Google monitoring adopts the old notification baseline during cutover, detects actual new `lastInviteAt` events, and treats running checks as pending rather than recovery. It does not change the sender journal. In particular, the user's manually sent second invitation must be recognized from Google's actual roster by the sender; migration does not mark that order confirmed or resend it.

Cutover order: isolated tests → commit/push → checksum-verified deployment → paused jobs and live script checks → actual Hermes scheduler/delivery verification → resume server jobs → pause the two existing Codex automations through the app tool. Roll back by pausing the new jobs and resuming the preserved Codex automations. Do not reactivate the older paused tasks or replace the existing sender/login timers.

Official references: [Kilo anonymous free access](https://kilo.ai/docs/gateway/authentication), [free-model limits](https://kilo.ai/docs/gateway/usage-and-billing), [Hermes cron and no-agent jobs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron). The live model catalog, rather than a fixed five-model list, is authoritative. Do not send confidential data to free endpoints.
