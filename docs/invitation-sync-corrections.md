# Invitation synchronization corrections — 2026-10-05

## Scope and decisions

Fix two reported problems in the established local repository and deploy committed source.

- Spotify: `Registered + Invited` means an actually issued new login. The buyer's unchanged original login must never be delivered with the new-account message. A newly issued login must be recorded by the partner; do not fabricate an account by substituting its domain.
- GrayTag YouTube: import an unambiguous buyer email on the next polling cycle, without an arbitrary settling delay. Keep the buyer-resend requirement after a seller asks for a different account. A correction updates the same Notion row and resets `Invited`.
- Keep cancellation handling and at-most-once delivery journals. Do not send another account correction to the incident buyer; the seller already corrected the address manually.

## Diagnosis

Investigated configured settling delay, historical chat scans, and upstream/session failures.

- The live YouTube reader explicitly passed five minutes to a minute-precision resolver, which adds another minute. Thus publishing an otherwise valid address waited at least six minutes plus poll duration.
- Every poll reread all unrepresented historical cancellations (eight at audit time). Import and delivery independently loaded the full seller listing. Lock age exceeded a polling interval. Sporadic upstream seller-read failures also appeared in logs.
- Read-only audit of six currently delivering YouTube orders found one unambiguous buyer address already correctly linked in Notion; five orders had no buyer-authored email in the returned chat. No fabricated backfill is appropriate.
- Spotify operational evidence showed one automated original-account message on October 4. The October 5 13:12 screenshot message differed from the automatic template. The Notion row was still the original address with both boxes checked, despite the seller's later manual correction.

## Tickets and implementation

- [x] Reproduce unchanged original Spotify credentials being sent as a newly issued login. Regression failed before the guard and passes after it.
- [x] Block that send, notify the seller without credentials, and recheck Notion and buyer chat immediately before a new completion send.
- [x] Remove the six-minute hold from the live YouTube email reader; default polling becomes 30 seconds.
- [x] Rotate at most two unrepresented historical cancellation chats per poll. Existing linked cancellations remain immediate; active imports run first.
- [x] Reuse a fresh seller-list snapshot within one locked cycle. Keep a fresh buyer chat and provider-status check before finishing delivery.
- [x] Regression for bounded history scanning and buyer correction before delivery failed before the fix and passes after it.
- [ ] Deploy committed release and verify operation. Correct the incident Notion row only after verifying seller-authored delivery of the actual issued address; preserve evidence in the private journal to suppress a duplicate buyer message.

## Verification

Nine relevant suites passed (167 tests); client build and whitespace review passed. The broad worker type check still reports pre-existing errors in chat streaming, API typing and WebSocket handler typing; none involve the changed guard or synchronization logic.

## Limitations

Thirty seconds is the poll interval, not a guaranteed end-to-end deadline. API latency, rate limits and upstream unavailability can add delay. Messages with multiple conflicting addresses or an unresolved different-account request remain pending intentionally. Checkbox checks do not verify Spotify authentication or prove that the supplier actually created the account.
