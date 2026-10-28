# Spotify Notion delivery diagnosis — 2026-10-28

The active GButs worker polls every 30 seconds. Read-only order/Notion/chat reconciliation found two recent orders already imported with Registered and Invited unchecked. Their request acknowledgements are saved; the vendor must finish the accounts before completion delivery. Completed bound orders retain their existing receipts. Three completed manual Notion rows have no order key and must not be assigned by timing alone.

A separate reproducible defect ignored Notion's `registered email` and `registered password` properties. The parser only read the original account title and Password, and delivery always converted the original email to the legacy domain. The new integration regression traverses the actual Notion client into the buyer message worker, failed before the fix and passes afterwards. Delivery now prefers explicit issued values, retains legacy behavior for empty optional fields, rejects malformed issued values, rechecks the fields immediately before sending, and journals the actual delivery pair. Buyer credential replacement clears stale issued fields. No credentials are logged.

Focused validation: 86 tests in six suites; client build passed. Repository-wide TypeScript checking reports existing errors in server/API modules; it is not a passing release gate.

## Everyview remains separate

There is no Everyview Spotify chat/Notion worker in the current source or active service inventory. The server's Everyview cookie is expired, while the user's Chrome is authenticated. Party s554 has two members; the latest buyer requested a new account on October 27 and has an acknowledgement but no completion reply. Its sharing description incorrectly refers buyers to GButs chat. Do not treat GButs worker completion counts as Everyview coverage.

One unassigned Notion completed row was created near that request and has an explicit registered email, but timestamp proximity is not proof of recipient identity. User confirmation of the mapping and current session renewal are pending. No account has been sent to an inferred buyer, no completion box has been asserted, and no uncertain send has been retried.
