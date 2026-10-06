#02: Compact GButs Netflix buyer access

**What to build:** Existing consent plus ID/PW/emailPIN and integrated mail confirmation without profile grid or create/delete instructions; build/review/deploy.
**Blocked by:**01.
**Status:** done

- [x] Trusted provenance selectscompactview including redactedpayload.
- [x] ID/PW/emailPIN only in basic information area.
- [x] Mail readsinsidepage retaining PIN gate and strictallowedorigin.
- [x] Legalwarning/name/PIN changes prohibited.
- [x] GrayTag/otherOTT unchanged.
- [x] Tests/review/commit/push/deploy/runtime smoke complete.

Verified in release 0ac5924 on 2026-10-06; 101 relevant tests pass. No real test listings or buyer chats were created.
