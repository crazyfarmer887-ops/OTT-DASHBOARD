# Linkid transient connection alerts

- [x] Verify the real five-profile runtime status and quantify poll request load.
- [x] Reproduce immediate Telegram alerting on one transient 429, then guard transient alerts behind a sustained failure window.
- [x] Reduce request frequency and include safe endpoint context for future intermittent 404s.
- [x] Repair the production alert-state file ownership so throttling can persist.
- [x] Test, review, deploy, and verify all five production profiles after the release.

Observed 2026-10-15: despite earlier 429/404 screenshots, five profiles had fresh successful snapshots, no profile errors, and no pending events. The alert-state file was root-owned and had not been updated since May, although the dashboard runs as ubuntu; corrected to ubuntu ownership and mode 0600. The exact cause of intermittent provider responses remains unconfirmed; this change lowers request pressure and records the failing endpoint if 404 recurs.

Release `84a05a6` passed 31 focused tests and the client build. After deployment the 3-minute cadence was visible in the authenticated Linkid dashboard, and all five profiles completed a fresh production scan by `2026-10-15T08:32:05.749Z` with no profile errors, no pending alerts and no account error. The seller alert state remained writable with mode 0600.
