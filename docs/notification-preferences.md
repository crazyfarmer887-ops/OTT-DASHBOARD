# Owner notification preferences

## 2026-10-29

The owner explicitly requested disabling the repeated Everyview Disney recruitment cutoff Telegram warning. Runtime release `b705f86` supports persistent `mutedKeyPrefixes` in the existing private seller alert state file. Production stores only `everyview-disney-cutoff:` in this new preference (preserving pre-existing preferences and throttling timestamps). Inventory and cutoff worker enabled flags remain on; buyer delivery and other alerts remain active. Alert state persistence retains the mute when unrelated notifications are sent. A mocked transport verification must return disabled with zero calls; it must never send a test message to Telegram.

Gmail filter saved and verified on the existing mailbox: sender `no-reply@gbuts.com`, subject OR group `상품 구매 안내`, `구독중인 상품 채팅 확인 요청`, `구매 영수증`. Actions: skip inbox/archive, mark read, never mark important. Applied to19 existing matching conversations. A connected Gmail search for matching inbox messages returned none. Refund, security and other subjects are outside this filter. Mail remains searchable in All Mail.
