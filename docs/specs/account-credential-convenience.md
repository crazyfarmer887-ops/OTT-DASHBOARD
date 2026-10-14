# Account credential convenience

## User request

The administrator should be able to see, hide, and copy OTT account passwords on a phone. The same controls should be consistent wherever OTT account credentials are displayed or entered.

## Behavior

- Registered GButs accounts, GrayTag account management and post writing, quick account creation, and Everyview account forms use one credential field design.
- Passwords are visible when the field opens; the administrator can hide or reveal them. ID, password, and PIN can each be copied. The existing combined account-copy action remains.
- Copy success is shown only after the browser confirms the write. A fallback supports browsers without the modern clipboard API. Copy and visibility controls never submit forms.
- Long values and date inputs fit a phone viewport; controls have comfortable touch targets.
- Existing authentication, account creation, sale and payment behavior remains unchanged.

## Verification

- Component tests cover visibility, exact copying, fallback, failures, and no form submission.
- Existing account-flow tests and the production build pass.
- The deployed administrator view is checked on a phone-sized browser viewport using fictional form values.

## Related polling repair

The GrayTag selling-list read fails with `terminated` when requested in one 500-row response; a 50-row read succeeds. The poller must read all selling-list pages of 50, reject malformed or repeated pages, then continue chat detection from the complete list. A failed page must not be treated as an empty list.
