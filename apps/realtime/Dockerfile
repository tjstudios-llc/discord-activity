FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
ENV NODE_ENV=development
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/realtime build
ENV NODE_ENV=production
EXPOSE 2567
CMD ["pnpm", "--filter", "@teamspace/realtime", "start"]
