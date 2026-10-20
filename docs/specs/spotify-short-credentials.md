# Compact Spotify new-account credentials

User request (2026-10-20): keep randomly generated `@jamkkangudok.com` logins for new Spotify accounts, shorten the local part, use a practical secure password, and deploy.

For an explicit buyer new-account choice, create the existing order-linked Notion row with `sp` plus ten random lowercase letters/digits and a 16-character password. Use Node's cryptographic random source; require lowercase, uppercase, digit and a symbol from `!@#$`, excluding ambiguous characters. The address local part is 12 characters; the password is not based on the address or order number.

Persist the pair in a private atomic journal before submitting it to Notion. Repeated order processing or an uncertain API response reuses that pair. Reject corrupt journals rather than silently generating new credentials; check locally reserved addresses for collisions. One scheduler process owns this journal, as with the existing single-flight Spotify worker.

Both Registered and Invited start unchecked. These values are credentials to create, not proof of a Spotify account or a sent invitation. Existing Registered + Invited guards continue to control buyer delivery. Buyer-supplied credentials/social-login conversion, existing Notion entries and manually chosen logins are preserved, including existing long pending names whose actual creation status cannot be established safely from unchecked boxes alone.

Verification: generated length/composition/uniqueness, file permissions, durable replay, corrupt-store rejection, uncertain Notion response, normal buyer sync, invitation delivery guards, build and deployed read-only smoke. Never create a synthetic customer sale, message or real Spotify account for testing.
