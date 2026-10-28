# Netflix real-page delivery guide

## Agreed behavior

The seller requested a readable mailbox URL and an image explaining email verification, then clarified that the guide must use actual page screenshots. New eligible sp1 purchases receive the existing numbered-profile instructions, account credentials, exact-address email URL and six-digit mailbox PIN, followed by one IMAGE attachment. Existing recipients receive no retrospective image. A repeated `!` credential request does not repeat the image.

The image is `assets/gbuts/netflix-email-guide-real-v1.jpg` (1040 × 1702). Its HTML layout and three actual email-verify.one screenshot crops are included alongside it. The PIN screenshot is blank; the mailbox screenshot shows the actual empty state and explicitly labels it. No fabricated received mail or authentication code is shown. The image contains no password, PIN value, OTP, account email or buyer information. Original capture date: October 28, 2026 KST.

The public uploaded asset is pinned by exact URL and SHA256 in `src/lib/gbuts-netflix-guide.ts`. It was uploaded once using the official seller `POST /api/common/images/upload`, multipart field `img`. Official frontend assets `index-ClQyxOre.js` and `chat-manager-BiRl4p5G.js` confirmed authenticated STOMP `/pub/chat/images` with `{accountSeq, payload:[url], roomId, type:'IMAGE'}`. REST `/api/rooms/{room}/chat` supplies IMAGE `images[]`. Browser rendering verified the uploaded asset is the full 1040 × 1702 guide; downloaded bytes match the committed image.

## Delivery boundaries

- Existing paid-member, exact private-room, current profile lease and safe-mode gates apply.
- Runtime opt-in file: `/home/ubuntu/.config/gbuts/netflix-email-guide.json` (override: `GBUTS_NETFLIX_GUIDE_CONFIG_PATH`). Fields: `enabled`, ISO `activatedAt`, `allowedAccountEmails`. Activate only sp1; orders bought before activation and previous direct recipients cannot reserve a guide.
- Prepare a frozen per-order `guideImage` journal before the first direct credential submission. Send only after the existing welcome and every direct account/mailbox/PIN text part are confirmed saved.
- Persist `attempted` before IMAGE SEND; confirm using seller IMAGE history. Unknown or post-SEND errors are query-only and never blindly replayed. A typed definite pre-SEND failure may retry; permanent failures remain blocked.
- Image-only errors explicitly state that account details have already been delivered. Do not overwrite credentials or PIN, alter profile allocation, enable general AI support, reopen suspended sales, or bulk-message historical buyers.
- Disable new image sends by setting runtime `enabled:false`; submitted images still reconcile from history. Keep journal records during rollback. The previous release tolerates the additional optional field.

## Verification

Tests cover text-before-image ordering, persisted reload, repeat requests, historical/excluded/disabled/refunded orders, lease release, uncertain text/image outcomes, seller-only IMAGE evidence, retryable/permanent failures, exact asset hash, invalid config/journal URLs and readable/legacy encoded email URLs. Shared authenticated text transport and Disney/Netflix/Spotify regressions are retained. No synthetic purchase or test buyer message is used in production.
