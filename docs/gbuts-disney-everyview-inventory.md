# Disney / Everyview inventory integration

This adds an opt-in read path for account-specific Everyview seat observations.
It does not create a party, import buyers, write a snapshot, or adjust either
platform's advertised seats. Those actions require a separate verified adapter.

`GbutsOttStore.disneyEveryview` is an object keyed by the SHA-256 of the trimmed,
lowercase Disney account email. Each value has a nonempty `partyIds` array and
`snapshots`, keyed by decimal party ID. Each snapshot has a source equal to
`everyview:<partyId>`, a verified timestamp, completeness flag, and claims with
opaque stable IDs, a state, and a verified profile number where known. The whole
record lives in the existing private GButs inventory store. Never log the map,
email hash, identifiers, or credentials.

Each Everyview snapshot must also state `advertisedVacancies`: its verified
unsold places available for purchase. It must have exactly that many non-released
claims with `kind: 'advertised'`; each is a separate held place. Missing or
inconsistent counts block GButs allocation and reposting. An advertised place
without a known reserved profile is held but blocks new allocation entirely.
GButs reposts also remain bounded by the existing GButs policy capacity.

Use the existing shared GButs inventory lock and atomic write when a trusted
adapter changes this data. A fresh snapshot must account for all current paid
buyers and pending/uncertain reservations; incomplete or stale data must never
be marked complete. Release a claim only after actual provider confirmation;
an omitted or changed member cannot be assumed refunded. The current Everyview
free-party HTML parser exposes display names rather than stable buyer IDs or
reliable profile numbers, so it is not sufficient evidence to build these
claims automatically. Reconcile identities and profile assignments first.

GButs Disney allocation considers these claims before choosing a number.
Renewal checks them after refreshing GButs buyers and again immediately before
publication. If the mapping is missing for an account, the historical GButs
path remains unchanged. Once a mapping exists, missing/incomplete/stale data,
unknown profiles, collisions, and excess occupancy block new assignments and
reposts without renumbering existing buyers. A two-minute maximum age applies.
Existing previously submitted posts still use their existing recovery path.

This is not cross-platform atomic inventory: independent platforms can accept
simultaneous purchases. A production rollout must provide source refresh,
slot-publication reconciliation, durable reservations and collision recovery;
until then the two platforms must not advertise the same unsold places.
