# Self-hosting (development foundation)

## Before you start

- Docker Engine and the Compose plugin
- A host with enough memory for PostgreSQL, Node services, and builds
- A unique, strong database password
- A reverse proxy and HTTPS before exposing the Activity publicly

## First boot

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` to a unique random value. Do not commit `.env`.
3. Run `docker compose -f compose.yaml up --build`.
4. Check `http://localhost:4000/health` and `http://localhost:4000/ready`.
5. Open `http://localhost:4173` for the Activity shell and `http://localhost:3000` for the Studio dashboard.

## Important limitations

This Compose file is a development foundation, not a production deployment recipe. Database schema migration/initialization, Discord authentication, secure sessions, TLS/reverse proxy configuration, and real-time authorization must be completed before public use. Ports bind to loopback by default. Do not expose them directly to the internet.

The Activity URL mapping and WebSocket routing must be configured in Discord Developer Portal and your reverse proxy. The current dashboard is a UI shell and does not yet save settings to the API.
