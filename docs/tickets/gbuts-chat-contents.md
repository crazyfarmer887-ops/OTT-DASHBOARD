# GButs chat contents tickets

- [x] G1 Inspect existing notifications and connected seller's product coverage.
- [x] G2 Include incoming text and product/buyer identity, with masking and bounded split delivery.
- [x] G3 Move alerts to one independent scanner across all seller posts; preserve existing Spotify receipts and isolate product failures.
- [x] G4 Verify regressions, long messages, retry, dedup, activation boundaries and production build.
- [x] G5 Commit/push/deploy, enable all-product scanning, confirm runtime scan and actual Telegram format-check delivery.

## Production evidence (2026-10-13)
- Committed/pushed code release `960f9c3` deployed to aio-dashboard. All-product scanning enabled at 11:03:13 UTC, interval 60 seconds, existing Telegram inquiry destination retained.
- 20 seller posts scanned. Runtime inspection confirmed 65 readable buyer rooms and one refunded buyer room denied by GButs (HTTP 400); this is tracked as unavailable.
- First scan sent 3 actual buyer messages in one alert. A separate, explicitly fictional format-check message also sent successfully through the same production formatter and Telegram sender.
- After final deployment, scan at 11:07:52 UTC recorded 20 posts, 0 send/read failures, 0 product errors, 1 unavailable refunded room, and 0 repeated messages. Receipt count remained 28 across restart.
- Existing authenticated dashboard API returned HTTP 200; journal permissions 0600.
