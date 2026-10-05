# Flexible YouTube buyer email selection

## User decision

The user requested conversational judgement instead of rigid email-token matching. Keep explicit buyer addresses as evidence and preserve the previously chosen buyer-resend requirement after a seller requests a different account.

## Implementation

- Fast path understands labels (`ID:`), Korean adjoining text, fullwidth separators, spaces around email separators, `골뱅이` / `점`, a trailing comma, balanced or angle wrappers, and explicit `A 말고 B` / `A 대신 B` corrections.
- Complete address letters are never invented or typo-repaired. URL/query addresses and malformed/obfuscated addresses remain excluded.
- Buyer cancellation or withdrawal clears the eligible address. Seller/system addresses are excluded. A seller's alternate-account request clears prior candidates; a seller reversal alone never reactivates them.
- Jev via the existing Typesafe connection evaluates only unresolved conversation context, choosing one of at most four explicit buyer-written candidates or none. Confidence/probability and candidate membership are checked. Ambiguous questions and classifier failures remain pending.
- Cache an unchanged conversation decision and coalesce simultaneous requests, keeping clear submissions immediate and avoiding repeated model calls at every poll. New messages create a new decision key.
- The live Notion email reader uses the contextual resolver. Existing pre-delivery freshness and at-most-once delivery checks stay in place.

## Tickets

- [x] Informal wording and withdrawal regression failed before the flexible parser; passes after it.
- [x] Tests for contextual selection, no invented addresses, role boundaries, seller rejection, cancellation and low-confidence/failure behavior.
- [x] Seven relevant suites passed (139 tests). Broad worker type diagnostics remain pre-existing; no diagnostics in the new modules.
- [x] Actual Jev connection passed four synthetic cases: second-address reference, reversed correction, later submission and unresolved alternatives. No real customer message was sent.
- [ ] Deploy committed release and check current Notion reconciliation.
