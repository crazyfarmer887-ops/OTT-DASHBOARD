#03: Explain registration blockers and prefill a new account's daily price

**Status:** done
**Origin:** User report "글 등록이 안돼" after release0ac5924.

Reproduce selected newly generated Netflix account with suggestedDailyPrice:null,5available places, valid end date, and no published listings. Before fix: daily price blank and register button disabled without an explanation. UI fixture failed twice in under1second.

- [x] Prefill150won/day for a selected account lacking a valid suggestion; keep known valid suggested rates and editable input.
- [x] Explain missing/invalid price, capacity or end date next to the registration button.
- [x] Keep frontend and server positive-integer price/capacity constraints consistent.
- [x] Regression tests, build and review.
- [x] Commit/push, release deployment and live UI verification (no automatic listing publication).

Deployed release 894a1ab. A fresh live page opening with the exact new Netflix account automatically displays 150 won/day and an enabled registration button. No listing was published during verification.
