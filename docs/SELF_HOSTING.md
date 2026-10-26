# Self-hosting (development foundation)

## Before you start

- Docker Engine and the Compose plugin
- A host with enough memory for PostgreSQL, Node services, and builds
- A unique, long alphanumeric database password (the example URL uses a placeholder)
- A Discord application configured for Activities, with its client ID and secret
- A reverse proxy and HTTPS before exposing the Activity publicly

## First boot

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` to a unique random alphanumeric value, and update the password in `DATABASE_URL` to match for direct host-side Prisma commands.
3. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. The client ID is public and is passed to the Activity build; the secret is injected only into the API at runtime.
4. Run `docker compose -f compose.yaml up --build`.
5. Check `http://localhost:4000/health` and `http://localhost:4000/ready`.
6. Open `http://localhost:4173` for the Activity shell and `http://localhost:3000` for the Studio dashboard.

Compose runs the committed Prisma migration before starting the API. The API verifies the Discord authorization code with Discord, retrieves the signed-in identity from Discord, upserts the user record, and stores a hash of a generated session token. The Activity keeps the returned token in memory rather than browser local storage.

## Discord configuration

Follow `DISCORD_SETUP.md` and configure the Activity URL mapping, public HTTPS URL, API origin, and WebSocket route for the actual deployment. The current local Compose URLs are only for local testing; they will not work as public Discord URLs.

## Important limitations

This remains an early development foundation, not a production deployment recipe. Team/workspace CRUD, membership and role enforcement, theme/layout persistence, and real-time message authorization are not implemented yet. Authentication needs end-to-end testing inside Discord before production use.

Ports bind to loopback by default. Do not expose them directly to the internet. Configure a reverse proxy with TLS, exact CORS origins, backup/restore, monitoring, and a production secret-management approach before public use.
