import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        configure(proxy) {
          // The Activity browser talks to its own origin. In development, Vite
          // forwards /api to Fastify and removes the browser Origin header so
          // Fastify's local-origin CORS allowlist does not reject Discord's
          // discordSays proxy origin. This is a dev-server-only proxy.
          proxy.on("proxyReq", (proxyRequest) => {
            proxyRequest.removeHeader("origin");
          });
        },
      },
    },
  },
});
