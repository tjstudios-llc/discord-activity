# TeamSpace Arena — Discord PvP Activity

A browser-based top-down 2D arena shooter designed to run as a Discord Activity, with a standalone local development mode.

Players authenticate through Discord, join **Team Battle** or **Free-for-all** matches, earn XP and coins, unlock characters and weapons, shop for gear, and keep their progression between sessions.

> **Status: early development.** This branch replaces the old TeamSpace workspace dashboard with the PvP game foundation. The Discord auth flow, database migrations, realtime WebSocket routing, and gameplay still require end-to-end validation in the configured environment before public release.

## Repository layout

- `apps/activity` — React + Vite game frontend and 2D canvas renderer
- `apps/api` — Fastify API for Discord sessions, profiles, inventory, shop, and leaderboard
- `apps/realtime` — Colyseus server-authoritative arena simulation and match rewards
- `apps/dashboard` — legacy dashboard shell (not the primary Activity experience)
- `packages/database` — Prisma schema, migrations, and PostgreSQL client
- `docs/PVP_GAME_SETUP.md` — PvP setup, environment, controls, security model, and validation checklist
- `docs/DISCORD_SETUP.md` — Discord Embedded App setup and OAuth flow

## Requirements

- Node.js 22+
- pnpm 10
- PostgreSQL 16 or compatible PostgreSQL service
- Discord Developer Portal application configured for Activities
- A reachable WebSocket endpoint for Colyseus (WSS in production)

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and update the password in `DATABASE_URL` to match.
3. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `VITE_DISCORD_CLIENT_ID`. Keep the client secret server-side.
4. Install dependencies with `pnpm install`.
5. Start PostgreSQL and create the database named in `DATABASE_URL`.
6. Run `pnpm db:validate`, `pnpm db:generate`, and `pnpm db:deploy`.
7. Set `VITE_REALTIME_ORIGIN=ws://localhost:2567` for local gameplay and start the services with `pnpm dev`.
8. For Discord-hosted testing, expose the frontend and realtime service over HTTPS/WSS and follow the Activity mapping guidance in `docs/DISCORD_SETUP.md` and `docs/PVP_GAME_SETUP.md`.

## Game trust boundaries

- Discord authorization codes are exchanged by the API; Discord client secrets never enter the frontend bundle.
- Session tokens are hashed in PostgreSQL and held in frontend memory only.
- The Colyseus service validates sessions and owns movement, shots, hit detection, kills, match results, XP, and coin rewards.
- Shop purchases and loadout changes are validated by the API against PostgreSQL inventory and balance.
- Unique database constraints and transactions protect inventory ownership and coin spending.
- Never trust client-provided XP, coins, kills, wins, damage, or match results.

## License

MIT. See `LICENSE`.
