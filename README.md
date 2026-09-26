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

The Notion sync runs every minute when configured in `.env.example`. Share the **Invitation Tracker** database with a Notion integration that has read, insert, and update content capabilities, then supply its token through `NOTION_API_TOKEN` on the server. Set `NOTION_INVITATION_EMAIL_IMPORT_ENABLED=true` to copy a single explicit buyer email into an unchecked Notion row. The hidden `Deal USID` property ties the row to its order; the partner only needs to see `Customer email`, `Invited`, and `from which account?`. A corrected buyer email keeps the previous address struck through above a down arrow and resets `Invited`. The hidden `Cancel waitlist` checkbox routes cancellation requests to the lower Notion view without a title suffix. A provider-confirmed cancellation strikes through the address, checks `Cancel waitlist`, and clears `Invited`; a cancelled order with one unambiguous buyer email gets a struck-through row even if it was cancelled before the first import.

**Paid vendor seat limit:** The **Paid Vendor Slot Ledger** data source stores each capacity adjustment as a row: `Change / reason` (required explanation), `Slot change` (positive or negative integer), and `Effective date`. Its initial entry is +60 seats from 12 vendor-managed family accounts in the 2026-09-23 through 2026-09-25 WhatsApp log; the direct-access account is excluded. Add a new row such as `10월 1일 슬롯 10개 추가 / 결제 완료` with `Slot change = 10` and `Effective date = 2026-10-01` to raise the limit. Add a negative row with a reason to lower it. The sum of effective entries is the limit; malformed or inaccessible ledger data blocks new automatic rows. Existing email corrections, refunds, and delivery checks do not consume a second row. Refund rows hold a seat until the vendor checks `Invite removed`; then that seat becomes reusable. The integration needs read access to this ledger as well as the tracker. This guard applies to automatic creation; Notion's own New button can still create rows directly, so monitor direct additions or restrict who may create pages.

The checklist paragraph immediately above **Invitation waitlist** displays `Available slots` and `Current slots: occupied/capacity`. The same one-minute Notion sync reads the paid ledger and tracker, and changes the paragraph only when the counts differ. `NOTION_SLOT_SUMMARY_BLOCK_ID` identifies that paragraph. A confirmed refund invite removal releases its occupied slot; the tracker row remains for audit. If either source cannot be read, the sync leaves the last displayed numbers unchanged and logs the error.

Set `NOTION_INVITATION_AUTO_DELIVERY_ENABLED=true` to complete a matching GrayTag order after the partner checks `Invited`. This uses the dedicated YouTube seller session and a journal stored outside release directories. Unclear buyer emails, duplicate manual rows, stale checkboxes, unavailable seller status, or an uncertain delivery response stop automatic delivery for that order. An uncertain response is reconciled by reading seller status; the finish request is never retried automatically. Safe mode pauses both Notion flows.

## Agent Rules

**CRITICAL: This project uses Tailwind CSS v4.** No `tailwind.config.js`, no `postcss.config.js`, no `@tailwind` directives. All configuration is CSS-first via `@theme` in `src/web/styles.css` and the `@tailwindcss/vite` plugin. Do NOT use Tailwind v3 syntax.

**IMPORTANT: Don't assume how a package works from memory.** Check the installed version in `package.json` and read docs in `node_modules/<pkg>/` before using any package. APIs change between major versions — guessing leads to broken code.
