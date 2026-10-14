# Account credential convenience and GrayTag polling repair

- [x] Reuse one visible, hideable, individually copyable credential control across OTT account screens.
- [x] Keep mobile inputs and action buttons usable in narrow layouts.
- [x] Reproduce the large GrayTag selling-list failure and page all results in bounded reads.
- [x] Test copy behavior and paging failures; build the client.
- [x] Review, commit, push, deploy, and verify the actual administrator view and GrayTag poll status.

Production verification (2026-10-14): release `b3ea8d0` is active. On a 390px viewport, the GButs account form showed a visible test password, hide/show worked, copying while hidden returned the exact test value, and there was no horizontal overflow. The test value was cleared. GrayTag poll status was `ok: true`, `consecutiveFailures: 0`, with a new successful cycle at `2026-10-14T07:32:28.663Z`.
