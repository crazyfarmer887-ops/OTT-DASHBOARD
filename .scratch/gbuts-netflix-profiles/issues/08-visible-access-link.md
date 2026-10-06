# 08 — Visible access link in GButs buyer chat

Baseline1403f7f. The2026-10-06 21:05 screenshot proves that the U+2028 five-paragraph single bubble still collapses in actual GButs chat. User requests immediate actual separation and explicit `접근 링크: {링크}`.

## Implementation / acceptance
Use one automatic delivery operation that sends three short consecutive messages: assigned profile/thanks; labelled private access link alone; account/PIN/household instructions and rules. Stop depending on unverified LF/Unicode rendering inside one bubble. This latest readability requirement replaces the prior single-bubble strategy. Use the existing saved-echo paragraph sender,500-byte per-part budget, pinned planned text and full seller-history verification. Three saved messages are required for success; partial/uncertain sends are not blindly replayed. Profile/link allocation stays unchanged.
Existing confirmed orders are not bulk replayed. Correct only the screenshot's identified current buyer 조라 with their same valid profile5 and existing private URL, checking current paid roster, profile lease, room identity and existing guide parts before sending. Verify exact saved parts and actual separate bubbles in the existing GButs page. No localhost permission workaround or dummy customer message.

## Regression seam
Broker transport test asserts three independent payloads, middle payload exactly labelled URL, all<=500 UTF8bytes, incomplete history not accepted. Default scheduler test asserts3 SENDs then no repeats on later polling. Existing pinned legacy/recovery reconciliation remains.
