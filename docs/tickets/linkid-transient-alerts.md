# Linkid transient connection alerts

- [x] Verify the real five-profile runtime status and quantify poll request load.
- [x] Reproduce immediate Telegram alerting on one transient 429, then guard transient alerts behind a sustained failure window.
- [x] Reduce request frequency and include safe endpoint context for future intermittent 404s.
- [x] Repair the production alert-state file ownership so throttling can persist.
- [ ] Test, review, deploy, and verify all five production profiles after the release.

Observed 2026-10-15: despite earlier 429/404 screenshots, five profiles had fresh successful snapshots, no profile errors, and no pending events. The alert-state file was root-owned and had not been updated since May, although the dashboard runs as ubuntu; corrected to ubuntu ownership and mode 0600. The exact cause of intermittent provider responses remains unconfirmed; this change lowers request pressure and records the failing endpoint if 404 recurs.
