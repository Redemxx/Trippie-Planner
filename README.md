# Trippie

Collaborative trip planner with a day-by-day itinerary timeline, interactive map, and an AI assistant for building and adjusting schedules.

Live at [trippie-planner.app.space](https://trippie-planner.app.space).

## Overview

Trippie organizes multi-destination trips by date around hotel check-in and check-out times, moving-day transit legs, and luggage drop-off windows when arriving early. Daily stops stay synced on a Leaflet map with category pins and lodging markers, and routes can be reordered around transit times.

An in-app chat dock (and DeepSpace agent tools) can add or batch-update stops, look up weather, and rebalance a day. Trips support viewer/editor invite links, live room presence, checklists, and itinerary export.

## Stack

- React 19, TypeScript, Vite, Tailwind CSS, Leaflet, React Router
- Cloudflare Workers with Hono and the [DeepSpace SDK](https://www.npmjs.com/package/deepspace)
- DeepSpace `RecordRoom` and `PresenceRoom` Durable Objects + Yjs
- Vercel AI SDK with Google Gemini (`@ai-sdk/google`), with optional per-user Gemini API key or OAuth credentials

## Local development

Requires Node.js (`>=22.15 <23`, `24.x`, or `26.x`) and npm (`>=11.6.0`).

```sh
npm install
npx deepspace auth login
npm run dev
```

`npm run dev` starts Vite alongside the local Miniflare Worker via `deepspace dev start`.

### Optional secrets

Set these in `.dev.vars` for local dev or with `npx deepspace secrets set` for production:

- `USER_CREDENTIALS_ENCRYPTION_KEY`: Derives per-app AES-256-GCM keys for encrypting user-supplied Gemini credentials
- `CARTO_API_KEY`: Enables Carto basemap tiles at `/api/map-tiles/*` (falls back to OpenStreetMap when unset)
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`: Enables per-user Google OAuth linking for Gemini in `/settings`

## Scripts

```sh
npm run test:unit    # Vitest unit tests
npm run type-check   # tsc --noEmit
npm run lint         # ESLint
npm run build        # Production Vite build
npm test             # DeepSpace test suite (smoke, api, e2e)
```

## App routes & layout

- `/` - Landing page
- `/home` - Main workspace
- `/trips/new` - New trip setup
- `/trips/:tripId` - Trip workspace
- `/settings` - Account and Gemini credential settings

```text
worker.ts            Cloudflare Worker entrypoint and Durable Object exports
wrangler.toml        Worker bindings and local dev config
src/
  actions/           Server actions exposed at /api/actions
  ai/                Chat routes, AI tool definitions, agent auth, Gemini fallback
  components/        UI components (trip timeline, Leaflet map, chat dock, landing)
  lib/               Route optimization, location search, itinerary export, crypto
  pages/             File-based React Router pages
  server/            Hono route handlers (auth/proxy, map tiles, Gemini, realtime)
tests/               Playwright and API specs
```

## Deployment

```sh
npx deepspace push
npm run deploy
```
