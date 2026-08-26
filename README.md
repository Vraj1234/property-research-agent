# Property Research Agent

Chat-based address research agent. Paste a US address, get back a sourced property dossier
(bed/bath, sqft, year built, owner, mortgagee, HVAC type, property tax, distance to nearest
fire station/hydrant) — every field labeled with which provider produced it.

See `PRD.md` for the full spec, `decisions.md` for why things are built the way they are,
`discussion.md` for the LLM/cost model, and `progress.md` for the live build tracker.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in the three required keys (`OPENAI_API_KEY`,
   `RENTCAST_API_KEY`, `PARALLEL_API_KEY`) — see `.env.example` for where to get each one.
3. `npm run dev` — runs at [http://localhost:3000](http://localhost:3000)

## Scripts

- `npm run dev` — local dev server (Turbopack)
- `npm run build` — production build
- `npm run start` — run a production build locally
- `npm run lint` — ESLint

## Stack

Next.js 16 (App Router) + TypeScript, deployed on Vercel. No database in v1 — stateless
per-request lookups.
