# Telegram: know whether the owner must act

One existing bot and the trusted platform topics remain. Customer text never chooses urgency, destination or a state label. The first line is visible in short iPhone/Mac previews; the second line always says what the owner should do. No new bot, permission grant, payment, purchaser-message transmission or fake callback button was added.

- 🔴 `[조치 필요]`: sound on. Read this first; a concrete action and navigation link identify the next step. It never means refund/replacement was already authorized or executed.
- 🟡 `[자동 처리 중]`: silent. Only an explicit trusted worker state can use it. Wait; no new periodic progress alert is created.
- 🟢 `[처리 완료]`: silent, confirmed results only. No action.
- 🔵 `[참고 알림]`: silent, original inbound/status information. No immediate action requested; it does not assert that an AI answered, an invitation was sent, or delivery finished.

Specific human actions are supplied for support handoff (refund/replacement/account restrictions/invite failures), Spotify delivery mismatch/uncertainty/source lookup failure, Linkid incoming chats/invite requests/session failure, NBA rejection/security checks, and deterministic Hermes Google/rank monitoring. Normal running/unchanged Hermes checks stay silent. A confirmed Google invitation or resolved monitor incident is explicitly completed. Existing throttle keys, incident receipts and historical delivery records are preserved; changing wording does not replay previous notifications.

GButs support: a human handoff says the room's automatic replies are paused. Reading the notification does not resume AI replies; checking the buyer's room also does not authorize refund/replacement. NBA says that only login checks run: no automatic password modification or spare consumption. Spotify uncertain delivery explicitly forbids blind resend. Auth failures ask for login reconnection instead of claiming that the worker can repair user authentication itself.

Navigation buttons are URL-only (buyer chat / action screen), with no callback_data and no financial/account side effect. GrayTag without a new explicit attention field keeps its old text and notification setting as requested. Unknown legacy providers also preserve old behavior.

Rollout requires the matching version in each executor: AIO, dedicated support worker, NBA monitor, and Hermes monitor scripts. Deploying only AIO does not change the other three running releases. Existing Telegram token/chat/topic routes must remain unchanged. Verify with mocked payloads and live read-only runtime metadata; do not send fake buyer/Telegram test messages or clear notification journals.

A future refinement, not implemented here, is one pinned "unresolved actions" board per platform, updated in place with issue age and direct links. A "handled" button would mean only acknowledged/reviewed, never approve a refund or modify an account. That requires durable action/task state and explicit scope before adding bot callbacks. Today's first-line/action/sound changes work with ordinary iPhone/Mac Telegram notifications and do not require that larger bot.

## Pre-deployment review corrections

Unclassified GButs/Linkid inquiries remain audible human-review alerts. Only a trusted caller explicitly asserting `notice` can make an inquiry informational/quiet; customer-controlled body text never chooses the classification. The independent Spotify monitor now says that it could not confirm delivery and asks the owner to check the source. It does not claim it stopped the separate sender. Hermes operational notifications use only fixed reviewed event/action descriptions, with no appended freeform Kilo summary; the configured Kilo route and optional helper remain available for other jobs. Existing normal/unchanged suppression remains.

Deployment checklist:

1. AIO: deploy the exact committed archive and update its release working directory/entrypoint; common sender, Linkid, GButs purchase/chat and Spotify monitor changes load here. Preserve `.env`/absolute journal paths and existing provider topics.
2. Support: its dedicated release includes `scripts/gbuts-support.ts` plus common `src/alerts/telegram.ts`. `deploy/dify-support/run.py` resolves its own repository root (`parents[2]`) before executing the TypeScript entry; update the actual wrapper/release target, not just AIO. Retain private support runtime/config/validation/room-pauses/receipts and existing policy version. These are notification-only changes and must not replay old consultations.
3. NBA: wait for the active hourly oneshot to finish, then update `/home/ubuntu/nba-login-monitor-current` to the exact release with `scripts/nba-login-monitor.ts`, `src/monitoring/nba-monitor.ts` and the common sender. Preserve `/etc/graytag-secrets/nba-login-monitor.env`, target state and hourly timer. Do not force a fresh login or replay notifications merely to test presentation.
4. Hermes: inspect the two existing migrated jobs' `script` and `workdir` under `~/.hermes/scripts/`. Deploy committed `deploy/hermes_ops` there and point the existing Google/rank job identities to that release (or update their existing managed scripts from the committed archive). Preserve job IDs, schedules, enabled/paused state, origin/topic, no_agent and all monitor deduplication state. Do not create duplicate jobs or change the main Hermes model. Read-only execution may return `[SILENT]` for an unchanged incident; that is expected and is not grounds to clear receipts.
5. Read-only final checks: correct working directories and active timers/services, no new runtime errors, retained journal permissions/incident timestamps. Mocked payload tests establish formatting/sound/URL-button behavior; no fake Telegram or customer message is required.
