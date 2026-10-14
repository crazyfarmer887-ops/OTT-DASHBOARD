# All-service Telegram chat contents tickets

- [x] A1 Inspect all connected chat notification paths and arrival-only/truncation branches.
- [x] A2 Share full-text splitting/redaction and stable part delivery keys; preserve GButs behavior.
- [x] A3 Include Linkid text in durable outbox and hydrate legacy pending entries.
- [x] A4 Include all eligible GrayTag buyer messages, YouTube invitation context and retryable pending reservations.
- [x] A5 Tests/review/build, commit/push/deploy, runtime verification, send the cited Linkid message with contents.

Release `be0f4b5` delivered the cited Linkid message with its body. GrayTag's existing 500-row selling-list read initially failed with `terminated`; release `b3ea8d0` reads complete 50-row pages and production polling recovered (`ok: true`, zero consecutive failures). GButs chat scanning remained healthy.
