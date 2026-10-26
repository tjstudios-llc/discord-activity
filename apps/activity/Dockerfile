FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
ENV DATABASE_URL=postgresql://teamspace:build-only@localhost:5432/teamspace?schema=public
ARG VITE_DISCORD_CLIENT_ID=
ARG VITE_API_ORIGIN=http://localhost:4000
ARG VITE_REALTIME_ORIGIN=ws://localhost:2567
ENV VITE_DISCORD_CLIENT_ID=${VITE_DISCORD_CLIENT_ID}
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN}
ENV VITE_REALTIME_ORIGIN=${VITE_REALTIME_ORIGIN}
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/activity build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
EXPOSE 4173
CMD ["pnpm", "--filter", "@teamspace/activity", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
