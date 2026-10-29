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

## Runtime verification on 2026-10-29

Implemented and deployed through committed releases; final runtime is `d86b57b`.
The Netflix incident was separately reproduced against actual correlated supplier replies: the portal rejected usable codes after 120 seconds. Its buyer-scoped 15-minute lookup now preserves strict email/kind/sender/reply checks and the legacy chat request window. A real affected buyer's PIN unlock and six-digit supplier lookup returned HTTP 200 without exposing codes in operational output. The buyer had also acknowledged resolution in chat. The combined regression suite passed368 tests and the frontend build passed.

Everyview rolling30-day / total KRW2910 parties707,708,709,710 were created and verified against seller/public pages, including account password, profile6 and email-code instructions. Each reserves exactly one profile separately from GButs's five-place policy. Both inventory and expiration cutoff configs contain all four parties. The initial account's attempt remains uncertain with no provider party ID; it is intentionally held and not resubmitted. Its reservation is retained and the owner receives the existing actionable-error alert. Creation is not complete for that fifth account. Do not claim all five have been published. The monitoring recovery can be delayed behind the shared inventory lock; the known confirmed party mappings were operationally reconciled without changing existing buyers.
