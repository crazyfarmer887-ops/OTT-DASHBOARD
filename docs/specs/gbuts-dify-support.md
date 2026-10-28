# GButs Dify support

Owner authorized existing-server 24/7 GButs support, first shadow drafts, then automatic responses only after validation; unresolved/refund/replacement decisions go to the existing GButs Telegram bot/topic.

## Decisions

- Existing repository is source of truth. Dedicated support process/container resources; no competing sales/invite/account-delivery workers.
- Dify version pinned and localhost-only. Workflow accepts a redacted context and returns a strict reply-plan enum, not arbitrary instructions. Existing server owns buyer verification, templates, delivery receipts and Telegram.
- Initial scope: verified active paid GButs subscription buyers. No unverified pre-purchase conversations are claimed supported. No credential, code, profile/family mutation, refund, replacement or compensation is performed by this agent.
- Shadow mode makes no buyer SENDs. Replay real recent redacted inquiries plus hostile/ambiguous/refund fixtures. Only reviewed low-risk reply plans can pass the promotion gate. Unknowns, explicit refund/replacement/dispute, repeated failed guidance, expired/refunded/ambiguous buyers, stale/failed source reads and model failure go to human review.
- Redact buyer/seller emails, credentials, numeric codes, URLs and identities before inference. No shared customer-context corpus or free-provider submission of private content. Free-route inference, if used, sees only an allowlisted anonymized intent representation.
- Latest buyer message only; recheck membership, seller/room and unchanged latest message immediately before SEND. Suppress after newer seller response. Bound rounds/cooldown, detect human takeover, persist attempt before send and recover uncertain sends by history only. Never automatically replay old drafts on promotion.
- Full handoff pauses that room until explicitly resumed. Telegram summaries contain reasons and attempted stages, no credentials; persisted notification receipts prevent spam and failed notifications retry. Model cannot veto a deterministic handoff.
- Config and private journals outside Git,0600; pause and global safe mode stop buyer sends. Resource/provider/API outages fail closed and remain observable. Operational status and proof of actual draft gate/service execution are required before claiming automatic mode.

## Verification

Tests at orchestration boundaries: paid/identity/expiry/isolation; shadow zero sends; refund/exchange/injection mandatory handoff; stale reads; seller takeover; bounded repeats; redact secrets; invalid workflow output; promotion proof/fresh activation; durable uncertain-send reconciliation; Telegram retry/dedupe. Real Dify workflow execution, private replay outcomes, localhost-only exposure, resource use and existing runtime checks must be observed separately from mocked tests.

## V2 error-guided support (2026-10-28)

Owner requested actual error-specific causes and actionable device-sensitive troubleshooting before escalation. Keep the Dify workflow and free-only privacy boundary. Add an official-source diagnostic catalog for Netflix, Disney+, Spotify and YouTube, with exact known error codes/phrases, bounded stages, follow-up context and no repeated completed guidance. Unknown symptoms ask for exact error/device first instead of immediate escalation. Only the anonymous diagnosis/stage/device labels reach inference; no raw conversation, codes, addresses or credentials. Shared-account recovery must not change passwords, household, memberships, payment or other users' sessions. Genuine household/country/family-change restrictions explain the constraint and hand off for operator review.

Preserve all existing journals, uncertain-send recovery, identity/safe-mode/recheck gates and pre-activation cutoff. Require new policy proof and shadow replay before V2 promotion. Add multi-turn tests through the real processInquiry boundary, including clarification -> exact error -> next step -> failure handoff, topic changes, stale device context, dangerous mutations, source specificity, no private data inference, and message-size safety. Do not test by sending synthetic buyer messages.

## V3 courtesy / split buyer-turn incident (2026-10-28)

A new YouTube purchaser sent onboarding, recipient address, a short continuation and courtesy thanks in four consecutive bubbles. V2 classified only the last bubble as resolved and sent a false success closure. Reproduced at processInquiry: expected delegated/silent, actual sent; standalone thanks and split unresolved+thanks also failed. Fix: bounded same-buyer contiguous turn aggregation (max12TEXT bubbles/6000chars/5minutes, stops at seller/attachment/cutoff), separate gratitude from explicit resolution, silent acknowledged receipt for courtesy, positive resolution only from buyer's actual assertion, negative/question guards, delivery request detection from address in invite services, fresh combined-turn recheck. Preserve existing receipts and owner pauses; no historical replays. A known blocked/unbound Google invite path must hand off, never claim completion or silently promise delivery. Do not resend this incident's invitation: later buyer history confirms receipt and seller already handled an address-change request.
