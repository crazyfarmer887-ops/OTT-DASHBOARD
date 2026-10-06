# Buyer guide delivery reliability

Status: implementing
Baseline: 742e76e

## Approved request
Send the approved Netflix guide, with the current buyer's actual access URL, to their GButs 1:1 chat. Automatically send that guide promptly for future purchases. Preserve the existing profile allocation, shared inventory and access checks.

## Evidence
- Current paid buyer had only their own message in the official chat history; the journal was `attempted`.
- Official web client limits its text input to 500 characters and subscribes to the room before publishing.
- The approved guide was 545 characters / 1,192 UTF-8 bytes. Native and SockJS SEND attempts returned no ERROR but no saved message.
- A 473-character Korean part was also rejected; a 70-character part was saved. Every separate paragraph (12–145 characters, each below 500 UTF-8 bytes) was then saved. The exact backend size rule remains undocumented: use both the observed web character cap and a conservative byte cap.
- Broker events use `{id, accountSeq, payload, type}`; HTTP history uses `{senderSeq, message, messageType}`.

## Acceptance
1. Stable paragraph parts must each fit 500 UTF-8 bytes and 500 characters without breaking a credential or URL.
2. Subscribe before publishing. Await a persisted message ID and exact seller/text echo for each part; opening a socket is not success.
3. Confirm only a complete approved guide in seller history (legacy full text or every exact part).
4. Definite pre-SEND failures are retryable; uncertain submissions are history-reconciled, with no blind replay.
5. Reconcile already assigned/delivered links before unrelated fresh GrayTag inventory. New assignments continue to require verified inventory.
6. Coalesced order polling runs every 5 seconds, with no overlapping inventory work.
7. Current buyer receives the actual guide; production journal must converge to confirmed without additional customer messages.

## Verification
New sender and synchronization regression tests reproduce silent oversized rejection, false success, incomplete history and pre-SEND retry. Production chat must show the URL and profile 1 guide.
