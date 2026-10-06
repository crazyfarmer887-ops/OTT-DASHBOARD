#04: Reliable verified inventory reads before GButs registration

**Status:** in progress
**Origin:** User reports 199won publication fails; asks to prevent recurrence through code.
**Baseline:**550aac7. Runtime uses the user-authorized replacement GRAYTAG_PROXY_URL; credentials stay in the protected server environment.

Observed: user publication returns '그레이태그 재고 응답을 확인하지 못했습니다.' before any new journal entry/POST. Same configured proxy alternates between valid responses and403. Code launches four inventory streams concurrently, and polling enqueues every30seconds even while earlier work is pending. Closed empty listings also trigger unnecessary full inventory reloads.

- Read verified inventory streams/pages sequentially; retry transient read failures at most3attempts with bounded waits. Keep malformed/authentication responses failing closed and never use partial/empty substitutes.
- Preserve providerHTTP status in safe actionable errors; honor bounded Retry-After for429.
- Coalesce scheduled checks while queued/running; skip inventory reload when no orders exist after verified seller listing/roster reads.
- Keep POST idempotency, unknown-outcome reservation, profile mapping and chat deduplication.
- Tests before fixes, review, commit/push/deploy; verify authenticated inventory and user-authorized199won publication when the provider permits access.

External service refusal cannot be guaranteed away. Persistent errors must remain visible and must prevent overselling.
