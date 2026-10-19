# Telegram service topics

- [x] Inspect bot/chat type and agree on three topics with the user.
- [x] Add explicit provider routing and tag all three service notification paths.
- [x] Verify routing and existing chat alert behavior with focused tests.
- [x] Enable bot private topics, create the three topics and save runtime settings.
- [x] Build/review, commit/push and deploy local committed source.
- [x] Verify actual per-topic delivery after the Telegram prerequisite is enabled.

2026-10-19: release `f158c73` committed/pushed and deployed to the existing aio-dashboard service. 48 focused Vitest cases and the dedicated YouTube polling test pass; local and release client builds pass. Runtime is active, authenticated seller status returns 200, and GrayTag polling is healthy with zero consecutive failures. No historical alerts were replayed.

Initial Telegram prerequisite (subsequently resolved): getMe reported `has_topics_enabled: false` for the existing private bot chat. Native Telegram button automation fails with an accessibility error; Telegram Web is not logged in. Asked the user to enable Topics/Threaded Mode for GTHelpPlzBot in BotFather. The sender preserved original delivery until topic creation/settings were complete.

Completion: the user enabled private topics and getMe confirmed it. Created exactly three topics (벗츠, 링키드, 그레이태그), saved their IDs in the private runtime journal, configured the service-specific systemd settings and restarted aio-dashboard. Sent one labeled connection check per provider through the deployed central sender; Telegram receipts confirmed the expected recipient and each matching message_thread_id. Journaled message receipts prevent setup replays. Existing bot/recipient, message contents, buttons and deduplication state are retained. Runtime active; authenticated seller status 200, GrayTag polling healthy, zero consecutive failures. No buyer messages were sent.
