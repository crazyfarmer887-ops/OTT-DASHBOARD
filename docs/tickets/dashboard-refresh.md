# Dashboard refresh tickets

- [x] Shared calendar period helper and accessible presets in sale forms.
- [x] Finance-inspired shell, navigation and design tokens throughout operations pages.
- [x] Spotify sales form/listing redesign.
- [ ] Tests/build/review, commit/push, deploy and desktop/mobile verification.

Pre-deploy: 105 Vitest cases across 10 relevant suites pass; 22 YouTube cases pass using their native node:test runner. Client build passes. Local production-build browser with authenticated read-only API forwarding verified 15 routes at 1440px/390px: no page errors or horizontal overflow, sidebar/drawer behavior passes. Spotify's four presets produced 2026-11-17, 2027-01-17, 2027-04-17 and 2027-10-17 for start 2026-10-18. No listing writes or deletions were performed. Existing project type-check diagnostics remain outside the new modules (including pre-existing unused values in write.tsx).
