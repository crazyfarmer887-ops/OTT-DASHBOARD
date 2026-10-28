# Spotify Notion delivery diagnosis — 2026-10-28

The active GButs worker polls every 30 seconds. Read-only order/Notion/chat reconciliation found two recent orders already imported with Registered and Invited unchecked. Their request acknowledgements are saved; the vendor must finish the accounts before completion delivery. Completed bound orders retain their existing receipts. Three completed manual Notion rows have no order key and must not be assigned by timing alone.

A separate reproducible defect ignored Notion's `registered email` and `registered password` properties. The parser only read the original account title and Password, and delivery always converted the original email to the legacy domain. The new integration regression traverses the actual Notion client into the buyer message worker, failed before the fix and passes afterwards. Delivery now prefers explicit issued values, retains legacy behavior for empty optional fields, rejects malformed issued values, rechecks the fields immediately before sending, and journals the actual delivery pair. Buyer credential replacement clears stale issued fields. No credentials are logged.

Focused validation: 86 tests in six suites; client build passed. Repository-wide TypeScript checking reports existing errors in server/API modules; it is not a passing release gate.

## Everyview remains separate

There is no Everyview Spotify chat/Notion worker in the current source or active service inventory. The server's Everyview cookie is expired, while the user's Chrome is authenticated. Party s554 has two members; the latest buyer requested a new account on October 27 and has an acknowledgement but no completion reply. Its sharing description incorrectly refers buyers to GButs chat. Do not treat GButs worker completion counts as Everyview coverage.

One unassigned Notion completed row was created near that request and has an explicit registered email, but timestamp proximity is not proof of recipient identity. User confirmation of the mapping and current session renewal are pending. No account has been sent to an inferred buyer, no completion box has been asserted, and no uncertain send has been retried.

## Deployed verification

Code release `6349c48` was committed/pushed, archived and checksum-verified, prepared with unchanged dependencies, tested on Linux (86 passing), built and deployed through the existing AIO systemd override. Authenticated local API smoke passed. The worker subsequently logged one startup and nine completed cycles with no Spotify sync failure or new message batch. Journals and prior service configuration were backed up privately; unrelated Google/NBA services were untouched.

Actual Notion re-read: 16 rows, three unassigned, two bound pending completions. One unassigned row has a non-empty `registered email`, but its value contains no at-sign and is not an email. The new reader sees it and correctly refuses to derive or deliver an invented identity. Its original Password is populated. The partner must provide a real issued address before this row can be delivered, in addition to confirming its buyer binding.

Everyview s554 and s618 sharingDescription/additionalInfo were updated through the authenticated official seller screen: only `GButs 1:1 채팅` was replaced with `에브리뷰 파티원과 채팅`. Both were saved without sending a login-change notification, then reloaded and visually verified. All dates, prices, capacity and member records were preserved. Browser cookie refresh was interrupted by concurrent foreground tab changes; a brief Chrome pause was requested. No Everyview worker or buyer delivery is claimed complete.

## Follow-up: Chrome pause and session renewal attempt

The user authorized renewing the Everyview session and investigating the buyer mapping without further manual identification. Native Cookie-Editor controls repeatedly lost popup context; neither JSON clipboard retrieval nor a private TextEdit paste yielded verified cookies. An attempt to open the observed extension page as a stable browser tab was explicitly rejected by the browser URL security policy (extension protocol disallowed, with a no-workaround instruction). Stopped automatic extraction and requested a user-exported private cookie file path. Do not try raw browser commands, direct browser storage extraction or another surface to bypass that rejection.

Additional read-only seller chat review: member554/1877's historic chat contains an exact email/password match to unassigned Notion row3fdff936-cc9b-80d2-b635-c70f10b23043. Later chat says access returned and seller acknowledged. The current extraction model abstains on the full conversation; this is only a historical matching candidate, not a newly verified outstanding delivery. No binding, new credentials or buyer message was written. Member554/2070's new-account request remains unresolved; the completed unassigned row cannot be assigned on timestamps alone. Everyview server session renewal, transport verification and automatic delivery wiring remain blocked on the private session export. Existing GButs release6349c48 remains healthy and unchanged.

## Session export supplied and integration deployed

The earlier blocked-state notes above are historical. The user subsequently supplied `~/Downloads/everyview.json.rtf`; it was converted privately, validated and saved to the server session file with restricted permissions. Authenticated server reads and an official read-only WebSocket handshake succeeded. No password/OTP flow or browser-security workaround was used.

Everyview integration release `828b01a` was committed/pushed, checksum verified, tested and built on Linux, then activated through the existing AIO service override. Existing environment, safe mode, buyer histories and unrelated services were preserved. A missing canonical Notion order record for s554/member2070 was backfilled with empty credentials and both flags false, without allocating an account or repeating the seller acknowledgement. The unassigned completed row remains unassigned. Explicit registered-email local parts now follow the existing partner-domain contract; the earlier note rejecting every local part is superseded by this validated rule.

The new administrator-only status endpoint rejects unauthenticated reads. Actual worker-cycle verification and fulfillment status are recorded after deployment; pending partner work must not be described as delivered.

Final production code is `f8e9c38`, with110 Linux tests and the build passing. Runtime verification exposed shared-worker starvation and intermittent free-model timeouts, so FIFO admission and per-listing phase yielding were added locally, tested, committed/pushed and deployed. Final Everyview scheduled completion is healthy and waiting for one partner fulfillment. The real buyer chat still has four messages, no new Everyview message receipts exist, and the canonical recovery row remains unique/pending. Actual account delivery is still contingent on verified issued fields and partner completion; no successful delivery is inferred from a healthy worker.
