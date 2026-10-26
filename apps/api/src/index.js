import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { prisma } from "@teamspace/database";

const env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
}).parse(process.env);
const allowedOrigins = new Set(env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));
const app = Fastify({ logger: { level: env.NODE_ENV === "production" ? "info" : "debug" }, trustProxy: false, bodyLimit: 1_048_576 });

await app.register(helmet);
await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"), false);
  },
});
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

app.get("/health", async () => ({
  status: "ok",
  service: "teamspace-api",
  timestamp: new Date().toISOString(),
}));

app.get("/ready", async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ready", checks: { database: "ok" } };
  } catch (error) {
    app.log.warn({ err: error }, "Readiness check failed");
    return reply.code(503).send({ status: "not_ready", checks: { database: "unavailable" } });
  }
});

app.get("/api/v1", async () => ({
  name: "TeamSpace API",
  version: "v1",
  status: "foundation",
  authentication: "not-configured",
}));

app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "not_found", message: "Route not found" }));
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Request failed");
  const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  return reply.code(statusCode).send({
    error: statusCode === 500 ? "internal_error" : "request_error",
    message: statusCode === 500 ? "An unexpected error occurred" : error.message,
  });
});

app.addHook("onClose", async () => { await prisma.$disconnect(); });

try {
  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
}
