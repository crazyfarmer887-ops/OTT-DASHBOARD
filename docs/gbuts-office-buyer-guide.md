# GButs MS Office invitation buyer guide

For the seller's MSOffice listing 16285, detect active paid members and immediately send a one-time private guide asking for the Microsoft invitation email. The same guide promises invitation within 24 hours and free extension equal to any delay, asking the buyer to wait. Keep paragraph separation readable in GButs. No password request, account credential delivery, Notion import or automatic invitation is included.

Verify the live listing's MSOffice category and complete member roster before sending; exclude refunded, pending-refund and expired buyers. Bind durable records to post/member/user/private room identity. Persist before transmission, reconcile uncertain sends against seller history and retry only definite pre-send failures. Repeated polls and process restarts must not duplicate the guide. Run an independent five-second single-flight poller using the existing seller session and safe-mode gate, controlled by GBUTS_OFFICE_AUTO_MESSAGE_ENABLED and GBUTS_OFFICE_POST_SEQ (16285 by default).

- [x] Add polling and durable guide delivery with focused tests.
- [x] Review, commit/push and deploy from committed local source; verify active polling and seller listing identity without creating test purchases/messages.

## Release verification — 2026-10-11 KST

- Source commit `9e51bcc`, pushed and deployed as `/home/ubuntu/releases/aio-dashboard-9e51bcc`; existing systemd environment preserved.
- Live listing 16285 verified as MSOffice category 530, ON_SALE, zero members. Office poller enabled and journal lastSuccess advanced across polls with no lastError; safe mode false.
- Authenticated safe-mode and existing GButs OTT orders APIs returned 200; public login returned 200. Existing Spotify and OTT enabled flags preserved.
- New focused tests: 9 passed. Full suite: 1117 passed / 153 failed; baseline ed9b896: 1108 passed / same 153 failures, identical failure groups. Build and diff whitespace checks passed. Incremental standards and spec review found no blocking issues.
- No synthetic real purchase or buyer message was created; live first-buyer transmission remains unobserved because the listing has no buyers.
