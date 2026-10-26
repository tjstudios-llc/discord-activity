# Discord application setup

This guide follows Discord's current Embedded App SDK flow and Activity local-development guidance. Keep all secrets out of browser variables and source control.

## Configure the Discord application

1. Create or select your Discord application in the [Developer Portal](https://discord.com/developers/applications).
2. Enable Activities and configure the launch/entry-point settings.
3. For OAuth2 Redirects, add Discord's documented placeholder `https://127.0.0.1` if this application uses only the Embedded App SDK authorization flow.
4. Set the Activity URL mapping for prefix `/` to the public HTTPS hostname serving the Activity frontend. Do not include a path or trailing slash in the hostname field.
5. Request only the OAuth scopes used by the app. TeamSpace currently requests `identify`.
6. Keep `DISCORD_CLIENT_SECRET` on the API server only. Never prefix it with `VITE_` or commit it.

## Run TeamSpace through Discord's proxy (recommended local setup)

Discord's proxy cannot serve your computer's `localhost:5173` directly as the Activity frontend. Use a tunnel to expose the Vite server, then map the Activity to that tunnel.

1. In the repository root, create your local `.env` from `.env.example` and set:
   - `VITE_DISCORD_CLIENT_ID` to the Discord application ID.
   - `DISCORD_CLIENT_ID` to the same application ID.
   - `DISCORD_CLIENT_SECRET` to the application's client secret.
   - A valid `DATABASE_URL` and the other server secrets required by the API.
   - Leave `VITE_API_ORIGIN` empty to use the same-origin `/api` path.
2. Start PostgreSQL and apply the Prisma migrations. Start the API and Activity dev server (for example, `pnpm dev` in a configured development environment).
3. Verify the frontend loads locally at `http://localhost:5173` and the API health/readiness endpoint is healthy.
4. In another terminal, run:
   ```sh
   cloudflared tunnel --url http://localhost:5173
   ```
5. Copy the HTTPS hostname printed by Cloudflare Tunnel.
6. In **Developer Portal → Activities → URL Mappings**, set prefix `/` to that tunnel hostname and save.
7. Relaunch the Activity in Discord. Do not enable Application URL Override when testing through the proxy.

The Vite dev server proxies requests under `/api` to the Fastify API on port `4000`. This keeps the Activity's API calls on the same origin as the page and avoids hardcoding `localhost:4000` into the Discord iframe. This proxy is for local development only; production deployments must route `/api` to the API through their reverse proxy or configure a reachable HTTPS `VITE_API_ORIGIN` and exact API CORS origins.

## Alternative: local URL override

Discord also documents a local-development flow using Application URL Override. In that mode, point the override to your local Activity server using the supported URL and platform requirements. Traffic does not pass through Discord's proxy, so API calls need to use full, reachable URLs and the API must allow the exact frontend origin. Do not mix this flow with the tunnel/proxy mapping flow above.

## Troubleshooting

- **`discordsays.com refused to connect`**: confirm Vite is running on port `5173`, the Cloudflare tunnel is active, and the URL mapping's `/` target is the current tunnel hostname—not `localhost:5173`.
- **TeamSpace loads but shows an API error**: confirm Fastify is listening on port `4000`, `/api` is reaching the Vite proxy, the database is ready, and the Discord client ID/secret are set correctly.
- **SDK handshake or authorization fails**: make sure the Activity was launched from Discord, the client ID matches the selected Discord application, and the app's Activity settings and OAuth configuration are saved. The SDK's `ready()` handshake occurs before `authorize()`, so a page that cannot load cannot reach the authorization UI.
- **Do not expose** database passwords, session secrets, or the Discord client secret in `VITE_*` variables.

Before production, test token exchange, session expiry/logout, multi-user workspace access, API authorization, and WebSocket connectivity. Do not request a bot token or bot permissions unless a separate bot feature is deliberately added.
