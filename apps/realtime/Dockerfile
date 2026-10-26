FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @teamspace/realtime build
EXPOSE 2567
CMD ["pnpm", "--filter", "@teamspace/realtime", "start"]
