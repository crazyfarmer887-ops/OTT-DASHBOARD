# YouTube buyer email import reliability

Baseline: c78fd65. User reports six GrayTag orders waiting for delivery without matching Notion rows on 2026-10-07. Continue the existing local repository and committed release workflow.

## Observed incident

Authoritative seller reads found six Delivering YouTube invitation orders. 장승현 D5BP and 김혜성 D5BI supplied complete buyer-authored Gmail addresses but have no Notion rows. 민 D5BO and 곽유빈 D56N already have unique order-bound, Invited Notion rows; their delivery journals are attempted and provider status is still Delivering. 정창용 D5BN has not supplied an email. 김지연 D4J3 explicitly requested cancellation and has not supplied an email. Capacity is 85, occupied 75; capacity does not block the missing rows.

The email context extractor can abstain even for an exact bare address. A settled email abstention is cached for 24 hours. Fresh classification selects D5BP; D5BI still abstains despite a literal address.

## Requirements

- A single unambiguous bare email in the latest substantive buyer message must not depend on an AI response. Use the existing deterministic parser and normalized buyer-authored content only; do not invent addresses. Later seller context still requires model review unless it is the exact existing automated email receipt. Buyer follow-ups containing only whitespace, the limited punctuation set `.?!…`, or the Korean crying/laughing characters `ㅋㅎㅠㅜ` do not replace the submitted address; any substantive follow-up still uses contextual review. Share that receipt text without duplicating its wording.
- Preserve withdrawal, cancellation, competing addresses and seller requests for a replacement account. A seller's later reversal must not revive an old address without another buyer submission.
- Email-mode AI abstentions expire after one minute, while confirmed results retain their existing cache lifetime. Credential-mode cache behavior stays unchanged.
- Import the two missing orders through the existing capacity-aware, order-bound Notion sync under its exclusive writer lock. New rows must remain uninvited. Verify fresh Notion rows and capacity summary.
- Do not import the email-less or cancellation-requested orders, mark anyone invited, or replay an uncertain delivery request. Independently audit the two existing attempted deliveries and report their actual provider state.
- Keep unrelated GButs/Spotify/Netflix behavior unchanged. Local tests, review, commit/push, deploy and production smoke checks precede declaring completion.

## Regression seams

Context selector: plain HTML-encoded buyer email succeeds with an abstaining selector, while withdrawal and replacement requests remain unresolved. Extraction cache: after an email abstention, a second decision becomes available after 60 seconds; credential abstentions remain cached. Existing email and Notion scheduler suites cover linking, cancellation, duplicate suppression and capacity.
