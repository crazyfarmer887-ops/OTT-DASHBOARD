# Telegram service topics

- [x] Inspect bot/chat type and agree on three topics with the user.
- [x] Add explicit provider routing and tag all three service notification paths.
- [x] Verify routing and existing chat alert behavior with focused tests.
- [ ] Enable bot private topics, create the three topics and save runtime settings.
- [x] Build/review, commit/push and deploy local committed source.
- [ ] Verify actual per-topic delivery after the Telegram prerequisite is enabled.

2026-10-19: release `f158c73` committed/pushed and deployed to the existing aio-dashboard service. 48 focused Vitest cases and the dedicated YouTube polling test pass; local and release client builds pass. Runtime is active, authenticated seller status returns 200, and GrayTag polling is healthy with zero consecutive failures. No historical alerts were replayed.

Pending Telegram prerequisite: getMe still reports `has_topics_enabled: false` for the existing private bot chat. Native Telegram button automation fails with an accessibility error; Telegram Web is not logged in. Asked the user to enable Topics/Threaded Mode for GTHelpPlzBot in BotFather. Until enabled and service thread IDs are configured, the deployed sender preserves the original destination, so alerts remain available in the existing chat. Do not mark topic creation/delivery complete before verifying Telegram responses.
