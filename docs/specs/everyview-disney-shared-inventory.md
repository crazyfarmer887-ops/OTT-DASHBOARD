# Everyview and GButs Disney shared inventory

Status: design and local tests in progress. Do not enable or create buyer-facing parties until the price and the full cross-platform workflow have been verified.

The seller requested 3- and 6-month remaining Disney accounts on Everyview, at KRW 2,900 per month, with six seats per account shared with existing platforms. Live inventory on 2026-10-29 identified three accounts ending 2027-01-24 and two ending 2027-04-24. Each has five existing sold-or-recruiting reservations and one additional unreserved place. Re-read all sources immediately before publication; these counts are not permanent.

The seller chose the period option at KRW 97/day. The official form's rolling period offers 30 days from each buyer's join date for a total of KRW 2,910, with monthly equivalent KRW 2,910. Its underlying account expiration date is not enforced by Everyview, so recruitment must stop and be verified no later than the conservative Korean midnight cutoff 30 days before actual account expiry. Based on the currently observed expirations those cutoffs are 2026-12-25 and 2027-03-25; recheck actual dates before creation and ongoing operation. A recurring party is not authorized by this choice. Do not promise a full three or six months to late entrants.

Requirements before publication:

* Explicitly bind each Everyview party to its actual account and live seller, without exposing credentials in logs.
* Preserve all existing buyers, profile assignments, terms and GrayTag operations. Count sold, currently recruiting, held, unconfirmed and non-refunded seats from every platform, with a hard account cap of six.
* Reserve unsold advertised places across platforms; a polling loop alone cannot make independent checkout systems atomic. A failed or stale source must not create additional vacancies. Unknown submissions require read-back reconciliation, not blind retries.
* Validate actual Everyview recruitment-count, zero-vacancy and hidden-listing semantics; never remove or disrupt existing buyers to close a listing. Confirm which mechanism controls actual billing at expiry.
* Everyview's account fields are shared across party members; assigning a distinct profile requires a verified per-buyer path. Never change a previous buyer's profile to resolve a conflict.
* Test concurrent purchases, account/profile mapping, expiry, refund and failure recovery locally, then verify live reads and deployment before enabling sales. Until then no listing is published and the original system remains unchanged.

Independent review identified additional rollout blockers: the observation runner is not wired to the server or to the shared inventory store; new GButs sales and some repost paths still bypass Everyview reservations; HTML empty-slot counts have not been verified against hidden or disabled slots; and absent account mapping currently falls back to GButs-only logic. Explicit mapping and a durable reservation must precede publication, and every publication path must fail closed on missing or stale data. The current changes are scaffolding, not an operational synchronization solution.
