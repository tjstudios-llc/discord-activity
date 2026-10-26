# TeamSpace Discord Activity

A customizable, self-hostable Discord Activity for teams and workspaces.

TeamSpace is designed around independent teams and workspaces, with optional Discord server linking. Hosted and self-hosted deployments share one codebase.

> **Status: early development.** Authentication, authorization, persistent workspace CRUD, and the complete Discord launch flow are not finished. Do not use this project for production workloads yet.

## Repository layout

- `apps/activity` — React + Vite embedded Activity client
- `apps/dashboard` — web administration dashboard
- `apps/api` — Fastify REST API
- `apps/realtime` — Colyseus real-time service
- `packages/database` — Prisma schema and database client
- `docs` — architecture, Discord setup, and security checklist

## Requirements

- Node.js 22+
- pnpm 10
- PostgreSQL 16 or compatible PostgreSQL service
- Discord Developer Portal application for integration testing

## Local setup

1. Copy `.env.example` to `.env` and configure local values.
2. Install dependencies: `pnpm install`.
3. Start PostgreSQL and create the database in `DATABASE_URL`.
4. Run `pnpm db:validate` and `pnpm db:generate`.
5. Start Activity/API/realtime with `pnpm dev`. Start the dashboard separately with `pnpm dev:dashboard`.

The Activity shell is a UI foundation, not proof that Discord authentication works. API readiness currently reports that database integration is not configured.

## Security principles

- Never commit secrets, OAuth codes, real user data, or production database dumps.
- Keep Discord client secrets on the server; never expose them via `VITE_*` variables.
- Every team/workspace read and write must enforce membership and role checks server-side.
- Only render widgets registered in an approved widget registry. Never execute workspace-provided JavaScript.
- Discord guild association is optional metadata, not proof of TeamSpace membership.

See `docs/ARCHITECTURE.md`, `docs/DISCORD_SETUP.md`, and `docs/SECURITY.md`.

## License

MIT. See `LICENSE`.
