# GButs private chat contents in Telegram (2026-10-13)

## Request and scope
The user requested viewing GButs 1:1 chat contents in the existing Telegram integration. Previously only Spotify buyer chat arrival notifications were sent, without contents.

## Implementation
- One independent scanner owns the existing chat receipt journal. It lists the connected seller's sale posts, including closed listings, then scans each buyer's personal chat. This includes Spotify, Netflix, MSOffice and other listed products.
- Telegram inquiry alerts include seller label, product, buyer nickname/identifier, order, timestamp and incoming text. Seller/system messages and non-text attachments do not generate content alerts. Labeled passwords and existing sensitive-value patterns stay redacted. Journals store only hashes and timestamps.
- Preserve Spotify's existing activation timestamp and acknowledged hashes. Other products use the new activation timestamp, avoiding a replay of old chat histories.
- Group message bursts, split long messages within Telegram limits, and acknowledge each successfully sent part. Failed or disabled sends remain retryable; restart preserves completed receipts.
- One scan at a time, default 60-second interval. Product failures do not stop the remaining products. An HTTP 400 for an already-refunded buyer is counted as an unavailable room rather than a retryable failure; accessible refunded-buyer chats are still monitored. No dependency on Notion credential extraction or inventory delivery progress.

## Release checks
- 76 targeted tests passed across chat content, masking, long message splitting, partial failure retry, restart dedup, multi-product scanning, Spotify credential sync, OTT delivery, Office guidance, existing Telegram and Linkid notification flows.
- Production client build passed. Application type check still has 54 existing diagnostics; none reference the changed source files.
- Enable `GBUTS_CHAT_ALERT_ENABLED=true` and set `GBUTS_CHAT_ALERT_START_AT` at deployment. Keep existing Telegram destination and Spotify activation timestamp/journal. Read runtime scan counters and send a clearly labeled fictional chat-format check through the existing Telegram sender.
