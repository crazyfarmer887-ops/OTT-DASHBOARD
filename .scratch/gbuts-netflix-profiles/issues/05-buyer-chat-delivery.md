# Buyer guide delivery reliability

Status: deployed and verified (ffb6c41)
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

## Review / release checks
- Spec review: 0 findings. Standards review: 0 blocking findings; clarified pre-SEND retry comment.
- Focused suite: 54 passed. Full suite: 1,044 passed / 153 pre-existing failures, no new failures.
- Build passed. App type diagnostics: unchanged 54 lines.
- Buyer chat history contains every approved paragraph; no further buyer sends after the user requested isolated short-guide testing.
- Short proposal with a same-length test URL: 398 UTF-16 characters / 842 UTF-8 bytes. Real single-message receipt is unverified. GButs rejects self PERSONAL rooms and empty GROUP rooms, so awaiting a designated test recipient. No shortened guide has been sent to the buyer.

## Production verification
- Active release: /home/ubuntu/releases/aio-dashboard-ffb6c41; configured proxy retained.
- Ping / seller session: 200; unauthenticated inventory: 403.
- Current buyer: profile 1, delivery confirmed; every approved paragraph present in seller chat history. Chat count stays 8 (one buyer + seven guide paragraphs), no replay after deployment.
- Worker enabled; lastSuccess fresh, lastError / order error cleared.
- Targeted server typecheck passed. Short-guide live single-message test remains pending a designated recipient; no real buyer was used for that test.
