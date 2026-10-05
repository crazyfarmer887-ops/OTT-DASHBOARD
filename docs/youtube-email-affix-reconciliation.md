# YouTube email parsing and Spotify title cleanup — 2026-10-05

## Confirmed problem

The user reported recent sales missing from Notion. Investigated seller availability, email parsing, and the displayed summary. Direct Notion reads showed 73/85 rather than the user's cached 72/85. One buyer's 18:32 message contained an address immediately followed by `입니다.`. The strict whitespace-token parser classified it as no email, so the previous audit incorrectly called this buyer an email non-submitter. This is a parsing bug, not a polling delay.

## Scope

- Accept ordinary Hangul prefixes and suffixes at email-token boundaries, including particles after balanced parentheses. Preserve URL/query, malformed-address, internal-obfuscation and multiple-address rejection.
- Reconcile eligible orders, update the visible summary, and verify each remaining waiting buyer separately.
- User additionally requested Spotify account cells show no down arrows. Show only the current account on future replacements and cancellations. Read legacy histories for migration compatibility; clean existing cells without changing passwords, order IDs or checkboxes. YouTube history arrows remain in use.

## Tickets

- [x] Regression for adjoining Korean text failed before the parser fix; six relevant suites pass after it (148 tests).
- [x] Regression for one-line Spotify replacement failed before the formatter fix; passes after it.
- [x] Add chat-resolver regression for the actual sentence shape and preserve different-account hold.
- [ ] Commit/deploy, reconcile missed buyer emails, clean existing Spotify title arrows and verify live counts.
