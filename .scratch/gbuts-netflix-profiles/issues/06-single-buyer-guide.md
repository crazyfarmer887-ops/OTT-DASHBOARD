# One private guide for future Netflix buyers

Status: deployed (dc98f28); live single-guide receipt awaiting a new buyer
Baseline: 0960dfd

## Approved request
Use the user's shortened Netflix guide, replacing the placeholder with each actual buyer access URL and their assigned profile 1–5. Automatically send it in one 1:1 message after detecting a new purchase. Do not resend to existing buyers, including the current buyer.

## Implementation / acceptance
- New Netflix orders use exactly the approved compact text: credentials/consent and household verification guidance, profile number, no profile/PIN/account changes or multiple simultaneous devices. Legal warning and troubleshooting remain on the access page/listing and are omitted from this chat as approved.
- One STOMP SEND for the entire text, including real link and profile. Never silently split this guide.
- Preserve 500-character web input cap. Bound the complete serialized frame to 1,000 UTF-8 bytes, below the rejected historical 1,163/1,340-byte frames. Real URL and normal room/seller IDs produce about 980 bytes. This is a conservative frame budget, not a verified published backend limit.
- Await exact saved-message ID / seller echo and confirm full history, retain definite pre-SEND retry and uncertain-send duplicate protection.
- Keep 5-second coalesced detection and verified inventory/profile allocation.
- Persist the attempted message so template updates cannot change reconciliation. Legacy attempted orders without this field reconcile the original full guide; confirmed orders are not replayed.
- Verify default scheduler → real transport seam emits one SEND and repeated polls do not send again.

## Live scope
No test messages to existing customers. GButs does not allow self PERSONAL rooms or empty GROUP rooms; live receipt of the new single guide can only be verified when a genuinely new buyer arrives or a separate authorized test recipient is supplied. Deployment smoke checks must report this limitation accurately.

## Review correction / verification
- Standards review identified a valid long room ID could exceed the conservative frame budget and retry forever. Permanent preflight failures now block with their actual explanation; temporary connection failures still retry. Recovery of never-sent MISSING orders is preserved.
- Actual production identifier sizes: room ID12 characters, seller ID6 digits, buyer token32 characters. The one-frame test now uses those exact lengths. Longer IDs are covered by explicit permanent-failure tests.
- Focused tests: 61 passed. Targeted server typecheck/build passed before review correction; repeated release checks follow.

## Final release evidence
- Focused tests61 passed. Full release suite1,051 passed /153 existing failures; no new failures. Server typecheck/build passed. Final Spec and Standards reviews: no remaining blocking findings.
- Deployed committed release /home/ubuntu/releases/aio-dashboard-dc98f28; service active, worker enabled, configured proxy retained.
- Ping/session200, unauthenticated inventory403. Current real buyer identifiers give compact text397 characters / complete SEND979 bytes, within the single-frame budget.
- Two existing orders are confirmed using prior guides and are not replayed. One joined during rollout before the new release was active. Current buyer chat count remains8 (one buyer message plus prior seven guide paragraphs).
- lastSuccess fresh and lastError/orderError clear. No actual new single guide has yet been received by a genuinely new post-deployment buyer; tests establish one SEND and persistence behavior, not unpublished GButs backend limits.
