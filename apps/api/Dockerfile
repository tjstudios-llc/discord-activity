FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/database db:generate && pnpm --filter @teamspace/api build
EXPOSE 4000
CMD ["pnpm", "--filter", "@teamspace/api", "start"]
