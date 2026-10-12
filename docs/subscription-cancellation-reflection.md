# Confirmed subscription cancellations

## Scope

Reflect service cancellations confirmed on October 11–12, 2026 in account management. Preserve historical paid status, credentials, members, and existing maintenance checklists. Cancellation metadata confirms that automatic renewal stopped, independently of whether prepaid access has ended. Do not change estimated profits by adding savings a second time.

## Implementation and acceptance

- Store cancellation records outside release directories, through an authenticated API.
- Display an automatic renewal cancellation badge on each affected account and replace its future renewal wording.
- Show all confirmed cancellations and monthly savings in an expandable summary, even if an account is hidden elsewhere.
- Distinguish newly cancelled subscriptions from previously cancelled ones. Linked Wavve/Tving accounts point to one payer and contribute no duplicate savings.
- Unknown end dates remain unknown. Refunds remain separate from monthly savings.
- Verify persistence, malformed data handling, authentication, bundle deduplication and client build before commit/deployment. Read back production records and check the rendered account management UI after importing operational evidence.

## Local verification — October 12

- 35 tests passed across cancellation records, payment-card metadata, maintenance credentials and admin authentication. Existing management payment UI checks: 2 passed.
- Production client build passed; reviewed changes for credential preservation, authentication and primary-account scope.
- The existing project-wide TypeScript check reports 54 lines of errors in pre-existing components, including management reconciliation naming and member types. No diagnostics mention the new subscription modules. This change does not resolve those unrelated failures.
- Operational import: 14 billing accounts plus 5 verified linked Tving logins; newly stopped monthly billing 225,100 KRW, including a previously cancelled account 244,600 KRW. Records are imported separately through the authenticated API and contain no credentials.
- Disney account 8 has a conflicting manual-member end date (November 4) after prepaid access ends October 12. Display this discrepancy for follow-up; recording a cancellation must not mark the member ended or restart a paid subscription.
