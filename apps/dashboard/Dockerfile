FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
ENV DATABASE_URL=postgresql://teamspace:build-only@localhost:5432/teamspace?schema=public
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/dashboard build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@teamspace/dashboard", "start"]
