# Invitation synchronization corrections — 2026-10-05

## Scope and decisions

Fix two reported problems in the established local repository and deploy committed source.

- Spotify: `Registered + Invited` means an actually issued new login. The buyer's unchanged original login must never be delivered with the new-account message. The user's subsequent clarification supersedes the manual-ID requirement: `Registered` confirms that the partner created the same local part under `@jamkkangudok.com`, with the same password. Derive the delivered address without requiring a Notion ID edit.
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
- [x] Initially block that send; subsequently replace the manual-ID restriction with the user-authorized Registered domain conversion. Keep Notion and buyer chat rechecks immediately before a new completion send.
- [x] Remove the six-minute hold from the live YouTube email reader; default polling becomes 30 seconds.
- [x] Rotate at most two unrepresented historical cancellation chats per poll. Existing linked cancellations remain immediate; active imports run first.
- [x] Reuse a fresh seller-list snapshot within one locked cycle. Keep a fresh buyer chat and provider-status check before finishing delivery.
- [x] Regression for bounded history scanning and buyer correction before delivery failed before the fix and passes after it.
- [x] Deploy committed release and verify operation. Correct the incident Notion row only after verifying seller-authored delivery of the actual issued address; preserve evidence in the private journal to suppress a duplicate buyer message.

## Verification

Nine relevant suites passed (167 tests); client build and whitespace review passed. The broad worker type check still reports pre-existing errors in chat streaming, API typing and WebSocket handler typing; none involve the changed guard or synchronization logic.

## Production evidence

- Runtime release `7850a06`, built from committed local source and pushed to the existing branch. Service active; imports and deliveries enabled; interval explicitly 30,000 ms.
- Two Spotify rows had the unchanged original address despite verified seller-authored delivery of the issued account. Corrected both to the actual `jamkkangudok.com` login, retained struck original history and both completion checks. Recorded manual delivery evidence in the private message journal; read-only send simulation attempted zero duplicate messages.
- Live YouTube import returned created=0, bound=0, updated=0, cancelled=0, capacityBlocked=0. All currently eligible addresses were already represented. Repeated audits found the same six pending orders: one represented email and five with no buyer email.
- Production logs after restart show successful delivery polling at 30-second intervals. API health and authenticated GButs seller connection return 200.
- Removed a lock left by the stopped service only after verifying its owner process was dead. Retained the previous release configuration and private journal backup for recovery.

## Limitations

Thirty seconds is the poll interval, not a guaranteed end-to-end deadline. API latency, rate limits and upstream unavailability can add delay. Messages with multiple conflicting addresses or an unresolved different-account request remain pending intentionally. Checkbox checks do not verify Spotify authentication or prove that the supplier actually created the account.

## Registered workflow clarification

The user explicitly rejected requiring the partner to edit the Notion ID. Registered confirms a newly created `@jamkkangudok.com` account using the local part of the displayed ID and its existing password. Registered + Invited sends this derived address. Invited alone keeps the existing-account completion reply. Registered alone does not confirm invitation completion.

The completion journal fingerprint now uses the delivered address, so changing the Notion ID from the original to the same issued address does not trigger another message. Remove the unchanged-ID block and its seller alert. Preserve chat freshness, cancellation checks and uncertain-send protection.

- [x] Regression: original ID + both checks sends the derived login, including after a buyer requests a new account.
- [x] Regression: later editing Notion to the derived address does not send twice; Registered alone does not send completion.
- [x] Six relevant suites passed (81 tests), code/whitespace review completed, committed and pushed, and runtime release `57bde7c` deployed. Production fixture smoke confirms domain conversion and duplicate suppression without sending real messages; health and authenticated GButs connection return 200.
