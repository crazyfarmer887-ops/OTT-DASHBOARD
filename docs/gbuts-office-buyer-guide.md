# GButs MS Office invitation buyer guide

For the seller's MSOffice listing 16285, detect active paid members and immediately send a one-time private guide asking for the Microsoft invitation email. The same guide promises invitation within 24 hours and free extension equal to any delay, asking the buyer to wait. Keep paragraph separation readable in GButs. No password request, account credential delivery, Notion import or automatic invitation is included.

Verify the live listing's MSOffice category and complete member roster before sending; exclude refunded, pending-refund and expired buyers. Bind durable records to post/member/user/private room identity. Persist before transmission, reconcile uncertain sends against seller history and retry only definite pre-send failures. Repeated polls and process restarts must not duplicate the guide. Run an independent five-second single-flight poller using the existing seller session and safe-mode gate, controlled by GBUTS_OFFICE_AUTO_MESSAGE_ENABLED and GBUTS_OFFICE_POST_SEQ (16285 by default).

- [x] Add polling and durable guide delivery with focused tests.
- [ ] Review, commit/push and deploy from committed local source; verify active polling and seller listing identity without creating test purchases/messages.
