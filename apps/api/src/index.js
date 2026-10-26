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
  DISCORD_REDIRECT_URI: z.string().url().default("https://127.0.0.1"),
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

async function requireSession(request, reply) {
  try {
    const session = await readSession(request);
    if (!session) {
      reply.code(401).send({ error: "unauthorized", message: "A valid session is required." });
      return null;
    }
    return session;
  } catch (error) {
    request.log.error({ err: error }, "Session lookup failed");
    reply.code(503).send({ error: "session_unavailable", message: "Session verification is temporarily unavailable." });
    return null;
  }
}

async function getTeamMembership(userId, teamId) {
  return prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { team: true },
  });
}

function slugify(value) {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  workspaceName: z.string().trim().min(1).max(80).optional(),
});
const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
});
const idParamsSchema = z.object({ teamId: z.string().min(1) });
const workspaceParamsSchema = z.object({ workspaceId: z.string().min(1) });
const taskParamsSchema = z.object({ workspaceId: z.string().min(1), taskId: z.string().min(1) });
const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).nullable().optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
}).strict();
const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "ARCHIVED"]).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);


async function createWorkspaceDefaults(tx, teamId, name, slug) {
  return tx.workspace.create({
    data: {
      teamId,
      name,
      slug,
      theme: { create: { config: { mode: "dark", accent: "#8ea7ff", background: "#080c18" } } },
      layout: { create: { config: { version: 1, widgets: [{ type: "tasks", id: "tasks" }, { type: "notes", id: "notes" }] } } },
      features: {
        create: [
          { key: "tasks", enabled: true, config: {} },
          { key: "notes", enabled: true, config: {} },
        ],
      },
    },
  });
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

app.post("/api/v1/auth/discord/exchange", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
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
        redirect_uri: env.DISCORD_REDIRECT_URI,
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
    access_token: discordAccessToken,
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


app.get("/api/v1/teams", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const memberships = await prisma.teamMember.findMany({
    where: { userId: session.userId },
    include: {
      team: {
        include: {
          workspaces: { select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true } },
          _count: { select: { members: true, workspaces: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return { teams: memberships.map(({ role, team }) => ({ ...team, role })) };
});

app.post("/api/v1/teams", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const parsed = teamCreateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Team name or slug is invalid." });

  const name = parsed.data.name;
  const slug = parsed.data.slug ?? slugify(name);
  if (!slug) return reply.code(400).send({ error: "invalid_request", message: "Choose a team name that can form a URL slug." });
  const workspaceName = parsed.data.workspaceName ?? "Home";

  try {
    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name,
          slug,
          members: { create: { userId: session.userId, role: "OWNER" } },
        },
      });
      const workspace = await createWorkspaceDefaults(tx, created.id, workspaceName, "home");
      await tx.auditEvent.create({
        data: { teamId: created.id, actorId: session.userId, action: "team.created", resourceType: "team", resourceId: created.id },
      });
      return { ...created, workspaces: [workspace], role: "OWNER" };
    });
    return reply.code(201).send({ team });
  } catch (error) {
    if (error?.code === "P2002") return reply.code(409).send({ error: "team_slug_conflict", message: "That team slug is already in use." });
    throw error;
  }
});

app.get("/api/v1/teams/:teamId", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const parsed = idParamsSchema.safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Team ID is invalid." });
  const membership = await getTeamMembership(session.userId, parsed.data.teamId);
  if (!membership) return reply.code(404).send({ error: "not_found", message: "Team not found." });
  const team = await prisma.team.findUnique({
    where: { id: membership.teamId },
    include: {
      workspaces: { include: { _count: { select: { tasks: true, notes: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
  });
  return { team: { ...team, role: membership.role } };
});

app.get("/api/v1/teams/:teamId/workspaces", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const parsed = idParamsSchema.safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Team ID is invalid." });
  const membership = await getTeamMembership(session.userId, parsed.data.teamId);
  if (!membership) return reply.code(404).send({ error: "not_found", message: "Team not found." });
  const workspaces = await prisma.workspace.findMany({
    where: { teamId: membership.teamId },
    include: { _count: { select: { tasks: true, notes: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { workspaces };
});

app.post("/api/v1/teams/:teamId/workspaces", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const params = idParamsSchema.safeParse(request.params);
  const parsed = workspaceCreateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Workspace details are invalid." });
  const membership = await getTeamMembership(session.userId, params.data.teamId);
  if (!membership) return reply.code(404).send({ error: "not_found", message: "Team not found." });
  if (!["OWNER", "ADMIN"].includes(membership.role)) return reply.code(403).send({ error: "forbidden", message: "Only team owners and admins can create workspaces." });

  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  if (!slug) return reply.code(400).send({ error: "invalid_request", message: "Choose a workspace name that can form a URL slug." });
  try {
    const workspace = await prisma.$transaction(async (tx) => {
      const created = await createWorkspaceDefaults(tx, membership.teamId, parsed.data.name, slug);
      await tx.auditEvent.create({
        data: { teamId: membership.teamId, actorId: session.userId, action: "workspace.created", resourceType: "workspace", resourceId: created.id },
      });
      return created;
    });
    return reply.code(201).send({ workspace });
  } catch (error) {
    if (error?.code === "P2002") return reply.code(409).send({ error: "workspace_slug_conflict", message: "That workspace slug is already in use for this team." });
    throw error;
  }
});

app.get("/api/v1/workspaces/:workspaceId/config", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const parsed = workspaceParamsSchema.safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Workspace ID is invalid." });
  const workspace = await prisma.workspace.findFirst({
    where: { id: parsed.data.workspaceId, team: { members: { some: { userId: session.userId } } } },
    include: { theme: true, layout: true, features: true },
  });
  if (!workspace) return reply.code(404).send({ error: "not_found", message: "Workspace not found." });
  return { workspace };
});


app.get("/api/v1/workspaces/:workspaceId/tasks", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const parsed = workspaceParamsSchema.safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Workspace ID is invalid." });
  const workspace = await prisma.workspace.findFirst({
    where: { id: parsed.data.workspaceId, team: { members: { some: { userId: session.userId } } } },
    select: { id: true },
  });
  if (!workspace) return reply.code(404).send({ error: "not_found", message: "Workspace not found." });
  const tasks = await prisma.task.findMany({
    where: { workspaceId: workspace.id },
    include: {
      createdBy: { select: { id: true, username: true, displayName: true } },
      assignedTo: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return { tasks };
});

app.post("/api/v1/workspaces/:workspaceId/tasks", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const params = workspaceParamsSchema.safeParse(request.params);
  const parsed = taskCreateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Task details are invalid." });

  const workspace = await prisma.workspace.findFirst({
    where: { id: params.data.workspaceId, team: { members: { some: { userId: session.userId } } } },
    select: { id: true, teamId: true },
  });
  if (!workspace) return reply.code(404).send({ error: "not_found", message: "Workspace not found." });
  const membership = await getTeamMembership(session.userId, workspace.teamId);
  if (!membership || membership.role === "VIEWER") return reply.code(403).send({ error: "forbidden", message: "Your role cannot create tasks." });

  if (parsed.data.assignedToId) {
    const assignee = await getTeamMembership(parsed.data.assignedToId, workspace.teamId);
    if (!assignee) return reply.code(400).send({ error: "invalid_assignee", message: "The assignee must be a member of this team." });
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        workspaceId: workspace.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        assignedToId: parsed.data.assignedToId ?? null,
        position: parsed.data.position ?? 0,
        createdById: session.userId,
      },
    });
    await tx.auditEvent.create({
      data: { teamId: workspace.teamId, actorId: session.userId, action: "task.created", resourceType: "task", resourceId: created.id },
    });
    return created;
  });
  return reply.code(201).send({ task });
});

app.patch("/api/v1/workspaces/:workspaceId/tasks/:taskId", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const params = taskParamsSchema.safeParse(request.params);
  const parsed = taskUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Task update is invalid." });

  const existing = await prisma.task.findFirst({
    where: { id: params.data.taskId, workspaceId: params.data.workspaceId },
    include: { workspace: { select: { teamId: true } } },
  });
  if (!existing) return reply.code(404).send({ error: "not_found", message: "Task not found." });
  const membership = await getTeamMembership(session.userId, existing.workspace.teamId);
  if (!membership) return reply.code(404).send({ error: "not_found", message: "Task not found." });
  if (membership.role === "VIEWER") return reply.code(403).send({ error: "forbidden", message: "Your role cannot update tasks." });

  if (typeof parsed.data.assignedToId === "string") {
    const assignee = await getTeamMembership(parsed.data.assignedToId, existing.workspace.teamId);
    if (!assignee) return reply.code(400).send({ error: "invalid_assignee", message: "The assignee must be a member of this team." });
  }

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: existing.id }, data: parsed.data });
    await tx.auditEvent.create({
      data: { teamId: existing.workspace.teamId, actorId: session.userId, action: "task.updated", resourceType: "task", resourceId: updated.id },
    });
    return updated;
  });
  return { task };
});

app.delete("/api/v1/workspaces/:workspaceId/tasks/:taskId", async (request, reply) => {
  const session = await requireSession(request, reply);
  if (!session) return;
  const params = taskParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "invalid_request", message: "Task ID is invalid." });
  const existing = await prisma.task.findFirst({
    where: { id: params.data.taskId, workspaceId: params.data.workspaceId },
    include: { workspace: { select: { teamId: true } } },
  });
  if (!existing) return reply.code(404).send({ error: "not_found", message: "Task not found." });
  const membership = await getTeamMembership(session.userId, existing.workspace.teamId);
  if (!membership) return reply.code(404).send({ error: "not_found", message: "Task not found." });
  if (!["OWNER", "ADMIN", "EDITOR"].includes(membership.role)) return reply.code(403).send({ error: "forbidden", message: "Your role cannot delete tasks." });

  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: existing.id } });
    await tx.auditEvent.create({
      data: { teamId: existing.workspace.teamId, actorId: session.userId, action: "task.deleted", resourceType: "task", resourceId: existing.id },
    });
  });
  return reply.code(204).send();
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
