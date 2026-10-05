# Notion chat extraction through OpenRouter

## Decision and scope

Use `nvidia/nemotron-3.5-lightning:free` on OpenRouter for buyer email/password interpretation before Notion updates. This supersedes Jev email context selection. Preserve order identity, buyer roles, fresh pre-delivery checks, Registered domain conversion, single-line Spotify titles, cancellation and duplicate-send journals.

## Reproduction

The incident-shaped Spotify message contains an order number followed by `스포티파이 아이디: … 암호: …`. The legacy parser returned null because `암호` was absent from its password labels. A regression reproduced this before changes.

## Design

Mask credential and ASCII token values with opaque IDs locally. The model selects only IDs and receives role-labelled context plus token kinds. Restore exact values locally; validate source role, complete pair, order of changed email/password and model confidence. Do not send literal credentials to the free model or silently use a different provider. Failed/ambiguous requests remain pending and retry. Cache unchanged successful conversations and coalesce concurrent calls.

## Tickets

- [x] Reproduce incident-shaped message.
- [x] Add primary OpenRouter interpretation to production Spotify Notion sync and completion chat recheck, plus YouTube Notion email selection.
- [x] Verify masking, malformed/low-confidence responses, role boundaries, changed credentials and offline behavior locally. Twelve relevant suites passed (202 tests); client build passed. Broad worker type diagnostics remain the existing 17 lines; no new extraction diagnostics.
- [ ] Verify actual model interpretations after account recovery.
- [ ] Commit/push, deploy and reconcile the actual incident against Notion.

## External verification blocker

The configured OpenRouter account returned HTTP 403 with `Inference is blocked on this account. Please contact support@openrouter.ai.` Even a generic request without customer data failed. All eight staged synthetic model cases failed at this account authorization boundary, so live interpretation is not verified. Do not replace the working production extractor with a provider known to be blocked. Waiting for account recovery or a working server environment key; no secret is printed or requested in chat.

Production audit found the incident as active order `15557:42184`, two buyer messages, legacy extraction false, zero matching Notion rows. Restore that explicit labeled pair as a guarded operational repair while provider activation remains pending.

## Incident recovery evidence

A guarded operational import using the committed staged release's corrected explicit-label parser created one row for `15557:42184`. A fresh Notion read verified exactly one matching order row and exact equality of its ID/password with buyer-authored chat; both Invited and Registered were false. No customer message was sent. This is a one-time data repair, not evidence that the requested OpenRouter model has been activated. Production continues the previously working `cf4f1bb` runtime until provider verification can succeed.

Resume gate: run `node --import tsx scripts/verify-notion-extraction.mts` with the server environment after OpenRouter account recovery. All eight live synthetic cases must pass before committed-source deployment and fresh Notion reconciliation. The verifier sends no buyer messages and prints no credentials.

## Replacement-key verification

The user supplied a replacement key. A production-host probe returned HTTP 200 and the exact requested model ID. Initial live fixture calls revealed that the model's default reasoning exhausted the 300-token budget and returned analysis without extraction JSON. Disable reasoning explicitly and reserve 600 output tokens. Strengthen the live gate so null expectations only pass after a complete, valid, confident structured reply, rather than treating truncated or malformed output as a correct abstention.

Disabling reasoning resolved response truncation, but unforced text responses often abstained on clear opaque references. An actual forced-function-call probe selected the correct email/password references with confidence 0.95. Use the model's supported tool-calling interface with a candidate-ID enum and parse its single `submit_buyer_account` call. A regression reproduces the provider's actual tool response shape. The live gate accepts confident selections or valid structured abstentions, and rejects empty/truncated output.
