import { createHash, randomBytes } from "node:crypto";
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
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
}).parse(process.env);

const allowedOrigins = new Set(env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));
const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  trustProxy: false,
  bodyLimit: 1_048_576,
});
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const exchangeBodySchema = z.object({ code: z.string().min(1).max(4096) });
const discordUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function readSession(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }
  return session;
}

function publicUser(user) {
  return {
    id: user.id,
    discordId: user.discordId,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
  };
}

await app.register(helmet);
await app.register(cors, {
  credentials: false,
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
  authentication: env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET ? "configured" : "not-configured",
}));

app.post("/api/v1/auth/discord/exchange", async (request, reply) => {
  const parsed = exchangeBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_request", message: "A valid Discord authorization code is required." });
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return reply.code(503).send({ error: "auth_not_configured", message: "Discord authentication is not configured on this server." });
  }

  let discordAccessToken;
  try {
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: parsed.data.code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) {
      app.log.warn({ status: tokenResponse.status }, "Discord authorization code exchange rejected");
      return reply.code(401).send({ error: "discord_auth_failed", message: "Discord authorization could not be verified." });
    }
    const tokenPayload = await tokenResponse.json();
    if (typeof tokenPayload.access_token !== "string") {
      return reply.code(401).send({ error: "discord_auth_failed", message: "Discord did not return an access token." });
    }
    discordAccessToken = tokenPayload.access_token;
  } catch (error) {
    app.log.warn({ err: error }, "Discord token endpoint unavailable");
    return reply.code(502).send({ error: "discord_unavailable", message: "Discord authentication is temporarily unavailable." });
  }

  let discordUser;
  try {
    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${discordAccessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userResponse.ok) {
      return reply.code(401).send({ error: "discord_auth_failed", message: "Discord identity could not be verified." });
    }
    const userPayload = await userResponse.json();
    const userParsed = discordUserSchema.safeParse(userPayload);
    if (!userParsed.success) {
      return reply.code(502).send({ error: "discord_invalid_response", message: "Discord returned an unexpected identity response." });
    }
    discordUser = userParsed.data;
  } catch (error) {
    app.log.warn({ err: error }, "Discord identity endpoint unavailable");
    return reply.code(502).send({ error: "discord_unavailable", message: "Discord identity is temporarily unavailable." });
  }

  const user = await prisma.user.upsert({
    where: { discordId: discordUser.id },
    update: {
      username: discordUser.username,
      displayName: discordUser.global_name ?? discordUser.username,
      avatar: discordUser.avatar ?? null,
    },
    create: {
      discordId: discordUser.id,
      username: discordUser.username,
      displayName: discordUser.global_name ?? discordUser.username,
      avatar: discordUser.avatar ?? null,
    },
  });

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.authSession.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt },
  });

  return reply.code(200).send({
    token,
    expiresAt: expiresAt.toISOString(),
    user: publicUser(user),
  });
});

app.get("/api/v1/auth/me", async (request, reply) => {
  try {
    const session = await readSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized", message: "A valid session is required." });
    return { user: publicUser(session.user), expiresAt: session.expiresAt.toISOString() };
  } catch (error) {
    request.log.error({ err: error }, "Session lookup failed");
    return reply.code(503).send({ error: "session_unavailable", message: "Session verification is temporarily unavailable." });
  }
});

app.post("/api/v1/auth/logout", async (request, reply) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return reply.code(204).send();
  const token = authorization.slice("Bearer ".length);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return reply.code(204).send();
  try {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    return reply.code(204).send();
  } catch (error) {
    request.log.error({ err: error }, "Session logout failed");
    return reply.code(503).send({ error: "session_unavailable", message: "Could not end the session right now." });
  }
});

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
