# TeamSpace Discord Activity

A customizable, self-hostable Discord Activity for teams and workspaces.

TeamSpace is designed around independent teams and workspaces, with optional Discord server linking. Hosted and self-hosted deployments share one codebase.

> **Status: early development.** The repository now contains the app shells, API foundation, Discord authorization-code exchange, hashed server-side sessions, initial Prisma schema/migration, and Docker Compose foundation. The Discord flow has not yet been validated end-to-end inside Discord. Team/workspace CRUD, membership enforcement, customization persistence, and real-time authorization are still in progress. Do not use this project for production workloads yet.

## Repository layout

- `apps/activity` — React + Vite embedded Activity client
- `apps/dashboard` — Next.js Studio dashboard shell
- `apps/api` — Fastify REST API and Discord auth exchange
- `apps/realtime` — Colyseus real-time service foundation
- `packages/database` — Prisma schema, migration, and database client
- `docs` — architecture, Discord setup, security, and self-hosting

## Requirements

- Node.js 22+
- pnpm 10
- PostgreSQL 16 or compatible PostgreSQL service
- Discord Developer Portal application configured for Activities

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and update the password in `DATABASE_URL` to match.
3. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `VITE_DISCORD_CLIENT_ID` (the public client ID is used by the Activity client).
4. Install dependencies: `pnpm install`.
5. Start PostgreSQL and create the database named in `DATABASE_URL`.
6. Run `pnpm db:validate`, `pnpm db:generate`, and `pnpm db:deploy`.
7. Start Activity/API/realtime with `pnpm dev`. Start the dashboard with `pnpm dev:dashboard`.

For a local container setup, see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md). Discord URL mapping and OAuth configuration are described in [docs/DISCORD_SETUP.md](docs/DISCORD_SETUP.md).

## Security principles

- Never commit secrets, OAuth codes, real user data, or production database dumps.
- Keep Discord client secrets on the server; never expose them via `VITE_*` variables.
- Every team/workspace read and write must enforce membership and role checks server-side.
- Only render widgets registered in an approved widget registry. Never execute workspace-provided JavaScript.
- Discord guild association is optional metadata, not proof of TeamSpace membership.

## License

MIT. See `LICENSE`.
