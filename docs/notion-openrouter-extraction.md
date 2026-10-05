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
- [ ] Verify masking, malformed/low-confidence responses, role boundaries, changed credentials, offline retries and real model interpretations.
- [ ] Commit/push, deploy and reconcile the actual incident against Notion.
