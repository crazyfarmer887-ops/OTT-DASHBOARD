# GrayTag secondary account session

The dashboard account selector includes `그레이태그 2호기` (`secondary`). Its server-side cookies are isolated from the primary and dedicated YouTube sales sessions. Missing secondary cookies never fall back to another account. Shared primary account records and caches remain isolated.

The admin-only import validates authenticated GrayTag access before atomically saving the allowlisted authentication cookies with mode 0600 at `/home/ubuntu/graytag-session/secondary-cookies.json`. Cookie values must never appear in documentation, logs or API responses.

The server checks the saved session five minutes apart (first check eight seconds after startup). A successful authenticated response may rotate the saved authentication cookies. Failed authentication or network errors do not overwrite the stored session. Two consecutive failures trigger the existing seller alert with an hourly throttle. Status metadata lives beside the saved cookie file as `.status.json`.

## Production verification — 2026-10-29

- Deployed committed release `6c9b478`; `aio-dashboard` active.
- User-supplied secondary session imported successfully through the authenticated admin endpoint; file mode 0600.
- Existing primary and YouTube cookie files were unchanged by import.
- Authenticated secondary GrayTag inventory read returned HTTP 200 and `succeeded=true`.
- Account selector API reported secondary connected; management request with `x-graytag-account: secondary` returned HTTP 200 without an error.
- Private temporary import files removed locally and remotely after import.

Chrome need not remain open. Site-enforced session expiry can still require a fresh authorized session; periodic reads cannot guarantee permanent authentication.
