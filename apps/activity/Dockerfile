FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/activity build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
EXPOSE 4173
CMD ["pnpm", "--filter", "@teamspace/activity", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
