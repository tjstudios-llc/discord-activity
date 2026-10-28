# TeamSpace Arena — PvP development setup

TeamSpace Arena replaces the previous TeamSpace workspace dashboard with a top-down 2D PvP shooter. It supports team battles and free-for-all, Discord Embedded App authentication, server-authoritative combat, and PostgreSQL-backed progression.

## Services and ports

- Activity frontend: Vite on `5173`
- Fastify API: `4000`
- Colyseus realtime server: `2567`
- PostgreSQL: local development database from `DATABASE_URL`

The API and realtime service use the same Prisma database package.

## Environment

Copy `.env.example` to `.env`, then set the Discord application ID and server-only client secret, a valid PostgreSQL `DATABASE_URL`, and the required local database credentials. Set both `DISCORD_CLIENT_ID` and `VITE_DISCORD_CLIENT_ID` to the public application ID. Never put `DISCORD_CLIENT_SECRET`, database credentials, or session tokens in `VITE_*` variables.

For local development, keep `VITE_API_ORIGIN` empty so the frontend uses the same-origin `/api` path through the Vite proxy. Set `VITE_REALTIME_ORIGIN=ws://localhost:2567` (or `VITE_REALTIME_URL` to the same value). For production, `VITE_REALTIME_URL` must be the public secure WebSocket endpoint (`wss://...`) routed to the Colyseus service; the frontend host must also route `/api` to Fastify.

## Database

After dependencies are installed and PostgreSQL is running:

```sh
pnpm db:generate
pnpm db:deploy
pnpm dev
```

The new migration adds game profiles, the item catalog, inventory, match records, and per-player match results. The API seeds catalog definitions into the database when a profile or catalog is requested. Each player starts with a Rookie character, Pulse Blaster, and 150 coins. The level curve requires 100 XP for level 2, 200 additional XP for level 3, and continues increasing by 100 XP per level.

## Authentication and trust boundaries

1. The frontend completes the Discord Embedded App SDK authorize/exchange flow.
2. Fastify validates the Discord authorization code server-side and creates a hashed, expiring session in PostgreSQL.
3. The frontend keeps the TeamSpace session token in memory only and uses it for game profile, catalog, shop, and loadout requests.
4. The Colyseus room validates the hashed session token against the same PostgreSQL session table before admitting a player.
5. The realtime server calculates movement, shots, hit detection, kills, match winners, XP, and coin rewards. The browser never submits a result or reward amount.
6. Shop purchases use a database transaction with a conditional coin debit and a unique user/item inventory constraint to prevent overspending and duplicate ownership.
7. Profile, level, coins, inventory, selected character/weapon, and match history persist in PostgreSQL across sessions.

## Controls and match rules

- Move: WASD or arrow keys. Mobile users can use the on-screen directional pad.
- Aim: mouse or touch pointer.
- Fire: hold the mouse button or the mobile FIRE control.
- Team Battle: red versus blue; same-team shots do not cause damage.
- Free-for-all: every player is an opponent.
- Matches run for three minutes. The initial rules award 100 XP and 25 coins for participating, 20 XP and 5 coins per elimination, plus 50 XP and 25 coins for a win. These values are server-side and can be tuned.

## Discord Activity configuration

Use the Discord Developer Portal's Activity URL mapping for the frontend host. Keep the Activity frontend and `/api` on the same HTTPS origin when using Discord's proxy. Realtime gameplay additionally needs a publicly reachable secure WebSocket endpoint routed to port 2567; set `VITE_REALTIME_URL` to that endpoint in the frontend build environment. Do not assume the frontend's HTTP URL mapping automatically proxies arbitrary WebSocket ports.

## Validation checklist

- Apply the migration and confirm `/ready` reports the database as ready.
- Open the Activity inside Discord and verify sign-in, profile load, and catalog load.
- Start one team match and one free-for-all match with at least two signed-in users.
- Verify movement, firing, damage, team damage prevention, respawn, and match end.
- Verify XP, coins, kills, deaths, wins/losses, unlocks, and inventory after refreshing/reconnecting.
- Try purchasing the same item twice and buying with insufficient coins; both must be rejected by the API.
- Verify an expired/revoked session cannot join the Colyseus room.
- Test production HTTPS/WSS routing, rate limits, database backups, and multi-client behavior before public release.

## Current limitations

This is the initial playable foundation. The item catalog is intentionally small; cosmetics are stored as owned inventory but are not yet rendered as a dedicated skin slot. Matchmaking uses Colyseus room matchmaking rather than ranked queues, party invites, or skill-based matchmaking. The current match length and reward values are initial tuning choices.
