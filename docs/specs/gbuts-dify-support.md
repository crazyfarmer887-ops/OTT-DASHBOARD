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
