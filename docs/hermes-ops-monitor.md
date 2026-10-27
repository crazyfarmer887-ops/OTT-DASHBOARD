# Codex status checks → server Hermes and Kilo

The active Codex Google-family monitor (five minutes) and subscription-rank monitor (hourly) move to Hermes cron on the existing operations server. Existing AIO rank workers, Google sender timer and NBA login timer remain the actual executors. The three already-paused Codex tasks and the existing paused Hermes task remain paused.

`deploy/hermes_ops` is the versioned source. Deploy an exact committed archive inside `~/.hermes/scripts/`; Hermes requires scripts to resolve inside that directory. Run `install.py` using the installed Hermes venv. It backs up configuration and job storage, adds the named `custom:kilo` provider and creates paused, per-job-pinned monitors. The main chat provider is preserved.

Each monitor is a no-agent script: healthy or unchanged checks emit `[SILENT]`, invoking neither an LLM nor Telegram. The deterministic checker can call only the existing authenticated renewal queue once per overdue service, respecting pause/safe mode and excluding the read-only generic-policy copies from the OTT path. It never directly creates/closes posts, edits policy settings, sends invitations, restarts services or reads browser sessions.

Only changed alerts are summarized via `kilo-auto/free`, using a newly rebuilt allowlist of event codes, service labels and counts. Raw policies, buyer data, credentials, bot tokens, cookies, API responses and logs never go to Kilo. Anonymous requests need no paid key; a free-router error never falls back to a paid model and never suppresses the deterministic alert. This also keeps existing confidential Hermes chat context out of free-model requests.

Google monitoring adopts the old notification baseline during cutover, detects actual new `lastInviteAt` events, and treats running checks as pending rather than recovery. It does not change the sender journal. In particular, the user's manually sent second invitation must be recognized from Google's actual roster by the sender; migration does not mark that order confirmed or resend it.

Cutover order: isolated tests → commit/push → checksum-verified deployment → paused jobs and live script checks → actual Hermes scheduler/delivery verification → resume server jobs → pause the two existing Codex automations through the app tool. Roll back by pausing the new jobs and resuming the preserved Codex automations. Do not reactivate the older paused tasks or replace the existing sender/login timers.

Official references: [Kilo anonymous free access](https://kilo.ai/docs/gateway/authentication), [free-model limits](https://kilo.ai/docs/gateway/usage-and-billing), [Hermes cron and no-agent jobs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron). The live model catalog, rather than a fixed five-model list, is authoritative. Do not send confidential data to free endpoints.

## Verified cutover — 2026-10-27

- Source `ccc48c0`, followed by `3dd3c16` for a bounded larger-budget retry when a free reasoning route returns no final text. Twelve monitor tests pass locally and under the installed server Hermes Python. Exact archive checksums were verified before extraction; the active scripts reside in `~/.hermes/scripts/gbuts-ops-3dd3c16/deploy/hermes_ops`.
- `custom:kilo` resolves to Kilo's exact HTTPS gateway with the non-secret anonymous placeholder. The real Hermes provider/OpenAI-compatible client returned `OK` through `kilo-auto/free` (actual route `reflection/beam-free`). The redacted operational-summary path also returned a Korean summary successfully. No paid fallback was added.
- Hermes jobs `a20eea5f5f51` (Google, every five minutes offset two minutes from the sender) and `949757503f8b` (rank, hourly at minute three) are active. Both ran successfully through the actual Hermes cron path and emitted silent output for unchanged states.
- One finite delivery-verification job `669f91fa1470` completed through the existing Telegram origin with `last_status=ok`, no delivery error and no unverified-delivery flag. It is completed/disabled and will not repeat. The existing gateway is enabled with user lingering already configured.
- Codex automations `google` and `automation` were paused via the app's automation tool after server execution and delivery verification. Their original prompts and schedules remain intact for rollback. The other three Codex automations and the unrelated legacy Hermes job remain paused.
- Main Hermes chat model, existing fallbacks, AIO, Google sender, NBA timer, buyer records and sender journal are preserved. Configuration/job-store backups are under `~/.hermes/backups/codex-kilo-migration-*`.
- The separate YouTube cookie-authentication failure remains unresolved. This migration monitors it; it neither bypasses authentication nor marks the owner's manual invitation confirmed. No new invitation was sent by this migration.
