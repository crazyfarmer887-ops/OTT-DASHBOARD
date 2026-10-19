# Telegram service topics

## Agreed behavior
Keep the existing GT 해결 필요 알림 bot and recipient. Group new notifications into three topics: 벗츠, 링키드, 그레이태그. Purchase, inquiry, auto-reply and connection/system categories follow their originating service. Preserve message bodies, buyer chat splitting, action buttons, deduplication keys and durable receipts.

Use an explicit provider field at trusted send sites, never buyer text or links. The central sender chooses the service topic before the existing category-topic fallback. Unclassified notifications (including Everyview) keep the existing general/category destination. Missing service settings preserve current delivery. Do not replay previous alerts or migrate history.

## Configuration
The current destination is a private chat with GTHelpPlzBot. Enable private topics through BotFather, create the three named topics, and configure SELLER_ALERT_TELEGRAM_GBUTS_THREAD_ID, SELLER_ALERT_TELEGRAM_LINKID_THREAD_ID and SELLER_ALERT_TELEGRAM_GRAYTAG_THREAD_ID with returned message_thread_id values. Retain the existing bot token and chat ID. Never commit tokens or recipient details.

## Verification
Test service/category precedence, absent-topic fallback, untrusted text isolation, caller provider tags, existing chat chunking and receipts. Build and review locally, commit/push, deploy committed source, preserve runtime data/settings, verify one clearly labeled test in each service topic. Do not send test messages to buyers.
