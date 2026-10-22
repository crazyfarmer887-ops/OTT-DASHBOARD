# GButs email-code request reminder

Status: deployment prepared in the established local repository; activation is
verified separately against the running production process. The original
`4cf17f6` implementation was recovered from the interrupted task and imported
without replacing the existing Disney ranking and Spotify workflows.

The existing all-product chat scan calls the reminder handler independently of
Telegram receipts. It classifies only the latest unanswered buyer request using
OpenRouter's fixed `nvidia/nemotron-3.5-lightning:free` chat model. No paid model fallback is configured. The
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

- 75 focused tests pass across reminder classification, chat scans, saved-message
  delivery and existing Spotify messages. Two added regressions cover GButs
  second-precision timestamps against millisecond send receipts, including
  recovery after an uncertain submission. Model/network responses are mocked;
  no buyer-send smoke test is used.
- `npm run build` and `git diff --check` pass.
- The server TypeScript check is compared with the unchanged `cbc8282` source
  snapshot. Existing diagnostics are recorded separately; no unrelated fixes
  are included in this feature.
- The production pre-activation probe found that `openrouter/free` could select
  a content-safety model instead of a JSON instruction-following model. Pinning
  the existing free chat model avoids that routing incompatibility.
