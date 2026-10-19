# GButs private chat authentication repair

## Incident — 2026-10-19

Spotify listing 17124 had one active paid buyer (member 47489). The private room was empty, while the guide journal had remained `attempted` since 09:06:29 UTC. A read-only live audit failed with `guide_delivery_missing 1`. An operational recovery using the previous sender also timed out after SEND and the room remained empty.

The official GButs chat client supplies `api_key: Bearer <seller token>` in its STOMP CONNECT headers. Our shared sender authenticated REST calls but omitted this separate chat authentication. An anonymous WebSocket could receive CONNECTED without saving messages, which left the durable uncertain-send guard preventing another automatic attempt.

## Repair

- Resolve the current saved seller session (falling back to the configured API token), validate it, and authenticate CONNECT before subscribing or sending.
- Fail before opening an anonymous socket if the seller session is absent. Preserve existing saved-message echo verification, payload limits and uncertain-send duplicate protection.
- Regression broker rejects unauthenticated CONNECT and verifies the full Spotify guide is saved. Existing shared OTT/Office callers retain the same transport.
- Recover only the verified affected order after checking current paid membership and the complete private-room history; retain all other journal records.

## Verification

- Before the fix: live missing-guide audit failed; authenticated-broker transport regression failed.
- After the fix: 86 focused tests across transport, Spotify messages/sync, OTT sync and Office messages passed. Production client build and whitespace review passed.
- Deployment and live recovery verification: pending.
