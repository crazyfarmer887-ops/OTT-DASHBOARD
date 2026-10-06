# 07 — Live single-message delivery and inventory delay

Baseline: a3011f7. User reports missed new buyer 쑤야보끔, then requests readable whitespace for future guides.

## Evidence
Buyer42568 was detected and attempted88 seconds after purchase on2026-10-06, but the397-character compact guide was not persisted. Its complete979-byte frame passing a mock1000-byte guard did not establish the unpublished provider limit. A211-character /388-byte recovery guide with the same assigned profile3 and private URL was actually saved and verified in chat history. Do not resend to this buyer.

## Acceptance
- Use the live-verified short guide for future Netflix buyers, with blank lines between profile, URL, access instructions and rules. One SEND, no paragraph splitting.
- Guard text itself to500 UTF-8 bytes as well as existing frame/input checks. This is a conservative local budget, not a documented provider limit. Await saved echo and exact seller history; connection alone is not success.
- Reconcile already saved short recovery guides even if the journal pins the older failed text; preserve legacy recognition, assigned profile/link and uncertain-send duplicate protection. Do not blindly retry an attempted SEND.
- Shared OTT inventory credential hydration skips unrelated YouTube chats/product lookups. Continue reading and validating all roster streams, keep all OTT and unknown-service claims, and preserve ordinary GrayTag dashboard behavior.
- Test against the original500-byte silent-rejection broker, a pinned-old/saved-new reconciliation fixture, profile/inventory/legacy regressions, build/typecheck and two-axis review. Deploy from committed local Git. Verify current recovered buyer becomes confirmed with no extra chat messages. Report actual measured inventory timing without promising all network calls are instantaneous.

## Scope
No new test messages to customers; no profile reassignment, no stale/unverified inventory reuse, no production source edits.
