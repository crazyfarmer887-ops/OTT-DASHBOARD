# Spotify listing registration

The seller can open Spotify listing registration from the GButs sales dashboard. Load title, description, country and purchase notices from the seller's previous Spotify invitation listing (15557). Default to its daily price and five places, with a new one-year period; allow editing before publishing.

Publish INVITE/category 20 listings without shared OTT credentials or GrayTag inventory. Persist each request before the external write, validate the resulting seller listing, and never repeat an uncertain write. Same-request replays and repeated identical active submissions must not create duplicates. Expose uncertain outcomes for reconciliation.

Every verified new listing joins the existing Spotify credential/Notion/Registered/Invited/private-message workflow alongside the legacy listing. A failure on one listing must not prevent processing others. Preserve current message templates, buyer identity checks, journals and Telegram scanning.

Verify template fidelity, payload/period validation, duplicate and uncertain-write handling, multiple-listing buyer isolation, UI navigation and form defaults. Build, review, commit/push, deploy the committed source, and smoke-test without publishing a synthetic sale.

Deletion (2026-10-18): GButs's observed seller UI offers recruitment closure (`POST /api/seller/subscribe/share/:seq/closed`) and destructive sharing termination (`/destroy`). The dashboard's Delete action confirms recruitment closure and hides the listing from the Spotify form and sales overview. Existing buyer monitoring continues using the retained registered listing ID; it must not invoke sharing termination or erase buyer/Notion/message journals. An unverified registration cannot be deleted. Failed or uncertain closure stays visible unless a read confirms CLOSED. Repeated deletion is idempotent. The confirmation and success notice explain that this closes recruitment and removes the dashboard entry; GButs retains the closed party record.


## Buyer automation reliability (2026-10-24)

- Run the new-buyer welcome phase for all registered listings before credential interpretation; this phase does not query Notion or call AI. Do not request credentials again when the buyer has already supplied an email or selected a new account.
- Credential import and completion delivery are independent attempts. An import failure must not suppress delivery of an already verified vendor completion. Preserve order joins, fresh account checks and uncertain-send journals.
- A model abstention with one buyer email and a supplied password is retryable after one minute. Incomplete/ambiguous credential abstentions retain the existing cache; successful decisions remain cached. No provider substitution or credential logging.
- Log scheduler startup and completed per-listing counts so enabled configuration can be distinguished from actual execution. Recover current missed orders once through the normal idempotent worker and verify Notion + saved private chat history.
