# Website

React + Vite + Hono + Tailwind + Node.js local server

## Project Structure

- `src/web/` — React frontend: pages, components, styles, hooks
- `src/api/` — Hono API server (`/api/*`)
- `public/` — Static assets (favicon, og-image, logo)
- `server.ts` — Local Node server that serves the API and the built frontend

## Quick Start

```bash
# Install dependencies
npm install

# Build the frontend
npm run build

# Start the local server
npm run start
```

The app will run at `http://localhost:3000` by default.

## Dev Mode

```bash
npm run dev
```

`dev` runs the same Node server through `tsx`.

## Routing

Client-side routing uses [wouter](https://github.com/molefrog/wouter). Add routes in `src/web/app.tsx`:

```tsx
import { Route, Switch } from "wouter";

<Switch>
  <Route path="/" component={Home} />
  <Route path="/about" component={About} />
</Switch>
```

## API

Backend uses [Hono](https://hono.dev/) on Node.js. All routes are mounted under `/api/*` in `src/api/index.ts`.

```ts
app.get('/ping', (c) => c.json({ message: 'Hello' }));
```

## Config

`website.config.json` contains the site name, description, and URL — use it as the source of truth for site-wide values.

## YouTube invitation checklist

The seller's new YouTube Premium purchase receives a short request for the buyer's Google email when `AUTO_REPLY_DAEMON_ENABLED=true`, `AUTO_REPLY_DAEMON_DRY_RUN=false`, `AUTO_REPLY_ENABLE_SEND=true`, and `YOUTUBE_INVITE_AUTO_MESSAGE_ENABLED=true`. Existing auto reply job fingerprints prevent duplicate guides. The guide uses the existing seller chat session.
If a buyer follows up about a still undelivered YouTube order without having supplied a usable Google email, the Jev reply scheduler sends one more targeted email request. It rechecks both the order and chat immediately before sending, and does not send this reminder for cancellations, ambiguous email changes, or orders with an identified buyer email.

The Notion sync runs every minute when configured in `.env.example`. Share the **Invitation Tracker** database with a Notion integration that has read, insert, and update content capabilities, then supply its token through `NOTION_API_TOKEN` on the server. Set `NOTION_INVITATION_EMAIL_IMPORT_ENABLED=true` to copy a single explicit buyer email into an unchecked Notion row. The hidden `Deal USID` property ties the row to its order; the partner only needs to see `Customer email`, `Invited`, and `from which account?`. A corrected buyer email keeps the previous address struck through above a down arrow and resets `Invited`. The hidden `Cancel waitlist` checkbox routes cancellation requests to the lower Notion view without a title suffix. A provider-confirmed cancellation strikes through the address, checks `Cancel waitlist`, and clears `Invited`; a cancelled order with one unambiguous buyer email gets a struck-through row even if it was cancelled before the first import.

**Paid vendor seat limit:** The **Paid Vendor Slot Ledger** data source stores each capacity adjustment as a row: `Change / reason` (required explanation), `Slot change` (positive or negative integer), and `Effective date`. Its initial entry is +60 seats from 12 vendor-managed family accounts in the 2026-09-23 through 2026-09-25 WhatsApp log; the direct-access account is excluded. Add a new row such as `10월 1일 슬롯 10개 추가 / 결제 완료` with `Slot change = 10` and `Effective date = 2026-10-01` to raise the limit. Add a negative row with a reason to lower it. The sum of effective entries is the limit; malformed or inaccessible ledger data blocks new automatic rows. Existing email corrections, refunds, and delivery checks do not consume a second row. Refund rows hold a seat until the vendor checks `Invite removed`; then that seat becomes reusable. The integration needs read access to this ledger as well as the tracker. This guard applies to automatic creation; Notion's own New button can still create rows directly, so monitor direct additions or restrict who may create pages.

The checklist paragraph immediately above **Invitation waitlist** displays `Available slots` and `Current slots: occupied/capacity`. The same one-minute Notion sync reads the paid ledger and tracker, and changes the paragraph only when the counts differ. `NOTION_SLOT_SUMMARY_BLOCK_ID` identifies that paragraph. A confirmed refund invite removal releases its occupied slot; the tracker row remains for audit. If either source cannot be read, the sync leaves the last displayed numbers unchanged and logs the error.

In **글 작성 → 유튜브 프리미엄**, the seller can publish without adding or selecting a family account. Choose an end date (or a duration shortcut), adjust the default **150원/일**, and choose how many individual listings to publish. The vendor assigns a real family account after a buyer pays; the existing chat-to-Notion and `Invited` delivery sync fulfill the order. The manually chosen listing count does not assert that physical Google-family seats are available. Each registration is idempotent and an uncertain result must be checked before retrying.
GrayTag rejected the sixth rapid YouTube registration with HTTP 403 after five successes on 2026-10-05; another attempt 30 seconds later was also rejected, while registrations seven minutes later succeeded. The server now admits at most five YouTube registration attempts per rolling eight minutes across dashboard tabs and restarts. It returns HTTP 429 with `Retry-After` before creating a claim, and the form preserves the remaining count for later registration. An actual provider 403 still remains uncertain until the seller inventory is reviewed.
The purchase and chat poller uses the same configured `GRAYTAG_PROXY_URL` transport as product registration. Direct server reads produced repeated HTTP 403 even while proxied seller reads succeeded, so the poller must not bypass that transport.

When `YOUTUBE_AUTO_LISTING_ENABLED=true`, the YouTube management panel accepts a real Google email for the next family manager. Every five minutes the server checks the Notion ledger, invitation tracker, and dedicated YouTube seller. It remembers the current listing title and guide, then waits until every observed listing is absent from OnSale and its provider status confirms a sale. With at least five free Notion slots and a queued manager, it creates the next numbered `n호기` group with five seats and a one-year end date, then registers five posts using the existing template, the same end date, and 150 KRW per remaining day. It saves each step and resumes an interrupted batch with the same registration keys. If the seller session, Notion ledger, template, or sale proof is unavailable, it does not publish. The next group requires an actual manager email; the system does not generate one.

Set `NOTION_INVITATION_AUTO_DELIVERY_ENABLED=true` to complete a matching GrayTag order after the partner checks `Invited`. This uses the dedicated YouTube seller session and a journal stored outside release directories. Unclear buyer emails, duplicate manual rows, stale checkboxes, unavailable seller status, or an uncertain delivery response stop automatic delivery for that order. An uncertain response is reconciled by reading seller status; the finish request is never retried automatically. Safe mode pauses both Notion flows.

## GButs Spotify invitation checklist

The private Spotify Notion database has the `Spotify account`, `Password`, `Registered`, `Invited`, and `GButs order ID` properties, with `Registered` immediately before `Invited`. The partner checks `Registered` after creating a new account and `Invited` after sending the family invitation. For a Gmail/social-login account, the partner may create a Spotify account with the buyer email's local part at `@jamkkangudok.com` and the supplied password, then replace the account address in the same Notion row. A buyer who explicitly chooses a new account without supplying credentials gets a blank, order-linked `New account requested` row for the partner to fill. The sync preserves a matching partner-selected address and requires both checkboxes before sending the new-account completion reply. A changed buyer password for such a manually selected address is left for review rather than reverting the address. The dashboard's `/spotify-invites` page connects the seller to the GButs account by validating access to listing `15557`; it stores an API session token in a private server file and never persists the login password. Google sign-in needs a session token. `GBUTS_SPOTIFY_SYNC_ENABLED=true` polls the seller's subscription member list and each active buyer's private chat about every 30 seconds once the seller session is connected. Buyer credentials may be labeled, or sent as two consecutive standalone replies to the seller's request for ID and password. A unique manually entered Notion row with the same credentials is linked to the order rather than duplicated. The member ID and listing ID form the order key, so duplicate email addresses cannot cross orders. A buyer's corrected email strikes the old address above a down arrow and clears `Invited`. A refunded member's address is struck and their stored password is removed. No buyer message is copied into logs.

With `GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED=true`, the seller sends one private request for credentials. `Invited` alone sends `초대 완료했습니다. 확인해주세요!` after the row matches the buyer's latest credentials. `Registered` plus `Invited` sends the account ID and password from the same row with an instruction to change both after login. A buyer who explicitly chooses a newly issued account can receive its manually entered credentials after both boxes are checked. The message journal stores a hash of the outgoing text, records an attempt before sending, and only confirms it after the text appears in chat history; an uncertain attempt is never blindly repeated. The GButs subscription seller interface currently exposes no separate delivery-complete action for this listing, so a checked row produces a private confirmation message rather than a platform delivery-complete call. The product listing should direct credentials to the private one-to-one chat before enabling unattended import; its existing public-comment instruction can expose passwords.

## GButs shared OTT sales

`/dashboard/gbuts-sales` publishes Netflix, Disney+, TVING and Wavve subscription listings for an existing account. Select the account, end date, daily price and reserved places. `GBUTS_OTT_SYNC_ENABLED=true` enables publication and paid-member checks about every five seconds using the already validated GButs seller session. Existing unlinked seller posts must be assigned to their actual account once in the dashboard before their orders can be monitored. The durable journal uses `GBUTS_OTT_STORE_PATH` or the persistent data directory, never a release directory. The API and polling worker run in one process and serialize inventory transactions.

GrayTag members, manual members, unsold listings, GButs places and uncertain submissions consume the same account capacity. Reserved places cannot be simultaneously advertised on both marketplaces. The GrayTag write flow also requires the selected shared account and rejects over-capacity publication. Unknown remote writes retain their places until read-only reconciliation. Unlinked existing GButs OTT listings block new publication rather than guessing account ownership.

Paid GButs members receive their own existing-style account access URL in private chat. Profile names are allocated per order, and password/PIN maintenance follows the shared account. Each send is journaled before transmission and confirmed against seller chat history; an uncertain send is never automatically repeated. Refunded, ended, missing or unverifiable orders cannot open account credentials. New GButs OTT delivery guides offer direct credentials on request: an active paid buyer can send exactly `!` in their private room to receive the current DB-backed `ID : ...` and `PW : ...`. Request fingerprints and outgoing hashes prevent repeated polling from duplicating a response; plaintext credentials are not copied into the delivery journal. Spotify continues using its separate Notion workflow. Real publication requires the seller to choose the listing details; deployment creates no arbitrary test sale.

## Agent Rules

**CRITICAL: This project uses Tailwind CSS v4.** No `tailwind.config.js`, no `postcss.config.js`, no `@tailwind` directives. All configuration is CSS-first via `@theme` in `src/web/styles.css` and the `@tailwindcss/vite` plugin. Do NOT use Tailwind v3 syntax.

**IMPORTANT: Don't assume how a package works from memory.** Check the installed version in `package.json` and read docs in `node_modules/<pkg>/` before using any package. APIs change between major versions — guessing leads to broken code.
