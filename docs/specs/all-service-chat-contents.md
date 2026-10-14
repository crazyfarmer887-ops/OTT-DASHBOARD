# All connected service chat contents in Telegram — 2026-10-14

## Request
The user supplied a Linkid arrival-only notification and requested readable chat contents in Telegram across all services. Connected chat providers are Linkid, GButs, and GrayTag (primary OTT and YouTube seller accounts). Everyview currently has no integrated chat adapter; this change does not claim coverage for an unconnected provider.

## Behavior
- New incoming buyer text is shown with provider/account/profile or buyer/order context, Korean Linkid timestamps, and a trusted original chat/dashboard button. Plain customer URLs cannot replace that button.
- Shared redaction and Unicode-safe message splitting preserve long text within Telegram limits. Labeled passwords and credential patterns are redacted. Per-part delivery keys prevent repeated successful parts after a partial failure.
- Linkid persists sanitized text and buyer identity in its existing pending outbox before sending. Legacy pending records are hydrated from snapshots or fetched history; no empty arrival-only substitute is acknowledged. Existing successful event keys remain seen.
- GButs retains its existing per-message/per-part receipts and scan behavior; only its splitter is shared with other providers.
- GrayTag no longer truncates buyer text at 800 characters or selects only the final message from the fetched page. All eligible buyer messages in that page are delivered oldest-first. Seller/system messages remain excluded; existing freshness gates and room/page scope remain.
- YouTube email invitation metadata is included alongside the original buyer message, retaining the existing invitation title and purchase topic. Standard chat alerts retain the inquiry topic. Other invitation workflow notifications remain unchanged.
- GrayTag stores pending reservations until all parts are acknowledged; a pending message remains retryable beyond the normal freshness window, including when the room is no longer marked unread.
- Historical chat backfill is not automatic. The one Linkid message explicitly cited by the user may be resent with its text as a labeled content addition without resetting the general seen journal.

## Verification and release
Targeted tests cover long Unicode text, redaction, stable part keys, partial failure, legacy Linkid pending hydration, all-provider shared formatting, GrayTag pending reservations and split buyer messages, plus existing GButs/Linkid/provider behavior. Production client build passes; app type check retains 54 pre-existing diagnostics, with none in the changed files.

Use local committed source → push → immutable release → preserve runtime data/settings → verify all three provider schedulers and Telegram delivery. Do not post test messages to buyers or publish sales listings.
