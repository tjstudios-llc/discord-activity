FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
# Install dev dependencies in the build stage so Prisma CLI and build tools exist.
ENV NODE_ENV=development
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/database db:generate && pnpm --filter @teamspace/api build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "--filter", "@teamspace/api", "start"]
