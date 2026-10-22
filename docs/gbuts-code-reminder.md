# GButs email-code request reminder

Status: implemented and tested locally; **not deployed or active in production**.
The existing host `ubuntu@43.155.153.165:2222` rejects SSH from this task environment
with `Operation not permitted`. No buyer message was sent during development.

The existing all-product chat scan calls the reminder handler independently of
Telegram receipts. It classifies only the latest unanswered buyer request using
OpenRouter's `openrouter/free` router. No paid model fallback is configured. The
model only returns a boolean and confidence; outgoing text is fixed:

> 안녕하세요. 이메일 인증코드 확인 방법은 위 안내에 적혀 있으니, 위 내용을 먼저 꼼꼼히 읽어 주세요. 감사합니다.

An authenticated seller must already have posted an email-code guide above the
request. Only active buyers and requests after the configured activation time
(and no older than 24 hours) qualify. A confident positive decision (>= 0.95)
is followed by fresh membership, room and conversation checks. A human reply,
refund, changed request, or report that the customer already followed the guide
prevents the automatic reminder. Unrelated inquiries still use the normal seller
notification workflow.

Request URLs, email addresses, labeled passwords, numeric codes and likely
credential tokens are redacted before inference. No guide text, seller account
credentials, buyer identity, or chat contents are written to the reminder journal.
The journal stores hashes and timestamps. Intent is written before SEND; unknown
outcomes are reconciled against seller history and never automatically resent.
At most one confirmed/uncertain reminder per room per 24 hours is permitted.
Classification failures back off for five minutes and keep seller alerts working.

## Activate after deployment

Deploy the committed source into the existing `aio-dashboard` release workflow;
preserve its existing environment and stores. Keep the existing chat-alert start
time and `GBUTS_CHAT_ALERT_ENABLED=true` setting. Add:

```ini
GBUTS_CODE_REMINDER_ENABLED=true
GBUTS_CODE_REMINDER_START_AT=<deployment-time ISO-8601 timestamp with timezone>
```

Reuse the server's `OPENROUTER_API_KEY`; do not paste a key into source or logs.
The activation timestamp must be set at deployment so old conversations are not
replayed. An optional `GBUTS_CODE_REMINDER_JOURNAL_PATH` can override the default
private data path. Restart the existing service and verify its health and the
reminder journal on the next legitimate new request; do not create a synthetic
sale or customer message. Disable only this feature with
`GBUTS_CODE_REMINDER_ENABLED=false`, retaining its journal for future reconciliation.

This feature is off by default; deploying code alone does not enable replies.

## Verification

- 69 focused tests pass across reminder classification, chat scans, saved-message
  delivery and existing Spotify messages. Model/network responses are mocked;
  no live inference or buyer-send smoke test was performed.
- `npm run build` and `git diff --check` pass.
- A focused TypeScript check reports the pre-existing
  `src/lib/youtube-invitation-poller.ts:131` unknown-to-string error. The same
  diagnostic is reproduced in the unchanged source checkout.
- GitHub read-only remote lookup also fails (`Could not resolve host: github.com`),
  so the commit is local and neither pushed nor deployed.
