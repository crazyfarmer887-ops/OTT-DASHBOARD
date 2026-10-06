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

## Release checks
- Focused suites:100 passed. Full suite:1,053 passed /153 existing failures (same failure count). Relevant server typecheck/build passed; app check retains54 preexisting diagnostic lines, none in changed files.
- Two-axis code review against a3011f7: Spec0 findings; Standards0 blocking findings (optional naming clarity only).
- Committed ba993ba pushed and deployed via Git archive; service active, worker enabled and configured proxy retained.
- Production smoke: ping/session200, unauthorized403. All3 current buyers confirmed with no order error. Recovered buyer retains profile3, exact saved guide and3 total chat messages; no duplicate was sent.
- Future formatted guide:215 characters /392 UTF-8 bytes, five paragraphs, one526-byte SEND. Formatting is tested locally; no new duplicate customer message was used as a live formatting test.
