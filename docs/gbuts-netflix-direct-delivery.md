# Netflix password-only private delivery

The owner requests that future GButs Netflix 1:1 messages stop sending email-verify.one access links: these accounts do not provide email forwarding. Instead, verify the paid buyer and account/profile lease, then send the current ID and password privately. Login instructions must not promise email PIN, household codes or forwarding. Preserve profiles, prices, paid expiry, renewal settings and delivery history; other services keep their existing behavior.

Current recovery is one verified buyer on GButs post18210, assigned profile1. The exact order, buyer and private-room mapping remain only in the private operational receipt. Gmail notifications match the visible buyer comments. Verify current membership/refund state and room participants before sending. Resolve current credentials in server memory only. Confirm the actual saved seller message; use an independent hashed operational receipt for uncertain-send recovery. Post one reply asking the buyer to check 1:1 chat only after private delivery is confirmed. Never put credentials in comments, email, logs or Git.

Future new Netflix guides contain profile assignment and password-only instructions, with no access link or email/code promises. After that guide is confirmed, direct credentials are sent automatically without a buyer bang. Existing link-only deliveries remain historical confirmation evidence; do not resend their old guide or automatically migrate every previously delivered buyer. Existing explicit buyer requests for current credentials remain supported. Keep durable before-SEND attempt/confirmation handling and restart deduplication. Persist no plaintext password in the sales journal.

Verify at the existing sync/transport seams: paid new buyer receives a link-free guide and current private credentials once; restarted/uncertain sends are reconciled; no credentials for refunded/ended/mismatched buyers; prior link-guide history is reconciled without re-sending; existing older buyers are not bulk-messaged; Disney remains unchanged. Test sender byte limits and fresh provider saved-message confirmation. Follow local tests/review/commit/push, archive deployment and production smoke checks.

A durable credentialDeliveryPolicy marker opts only newly submitted Netflix password-only guides into automatic credentials; behavior does not depend on exact mutable guide wording. Historical orders without this marker require a buyer request or explicit scoped seller operation.


## Explicit one-off public-comment exception — 2026-10-26

The owner specifically requested posting the current credentials in the complaining buyer's comment thread. Anonymous read access and the lack of a private-comment option were verified first; after being told that anyone could read/use the credentials, the owner explicitly approved public publication at action time. Current paid membership, profile lease and credentials were revalidated, one reply was submitted, and both authenticated saved-message comparison and anonymous readback confirmed the exact body hash. Only hashed receipts and identifiers were retained privately; credentials are absent from logs, artifacts and Git.

This is a one-reply owner-authorized exception. Automatic/future delivery remains private, and no account/profile/price/expiry/renewal setting was changed. The exact buyer/order/comment mapping is in the private operational receipt and the calling task's redacted artifacts/netflix-public-comment-20261026/confirmed.json.
