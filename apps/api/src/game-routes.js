import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@teamspace/database";

const catalog = [
  { slug: "rookie", name: "Rookie", type: "CHARACTER", description: "Your first arena operator.", price: 0, unlockLevel: 1, rarity: "common", isStarter: true, stats: { speed: 1, health: 100, color: "#62e6c5" } },
  { slug: "vanguard", name: "Vanguard", type: "CHARACTER", description: "A sturdy frontline specialist.", price: 450, unlockLevel: 1, rarity: "rare", isStarter: false, stats: { speed: 0.92, health: 125, color: "#78a8ff" } },
  { slug: "phantom", name: "Phantom", type: "CHARACTER", description: "A fast, elusive arena runner.", price: 700, unlockLevel: 5, rarity: "epic", isStarter: false, stats: { speed: 1.12, health: 90, color: "#c08cff" } },
  { slug: "blaster", name: "Pulse Blaster", type: "WEAPON", description: "Reliable starter weapon with balanced fire rate.", price: 0, unlockLevel: 1, rarity: "common", isStarter: true, stats: { damage: 25, cooldown: 0.32, speed: 540 } },
  { slug: "rapid-fire", name: "Rapid Fire", type: "WEAPON", description: "Faster shots with lighter damage.", price: 500, unlockLevel: 1, rarity: "rare", isStarter: false, stats: { damage: 14, cooldown: 0.16, speed: 620 } },
  { slug: "heavy-pulse", name: "Heavy Pulse", type: "WEAPON", description: "Slow, powerful shots for precise players.", price: 800, unlockLevel: 3, rarity: "epic", isStarter: false, stats: { damage: 45, cooldown: 0.7, speed: 460 } },
  { slug: "neon-trail", name: "Neon Trail", type: "SKIN", description: "A bright cosmetic trail for your shots.", price: 250, unlockLevel: 1, rarity: "uncommon", isStarter: false, stats: { trail: "#ff72c6" } },
  { slug: "golden-core", name: "Golden Core", type: "SKIN", description: "A gold finish for your arena gear.", price: 900, unlockLevel: 1, rarity: "legendary", isStarter: false, stats: { tint: "#ffd166" } },
];

function levelForXp(xp) {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (remaining >= level * 100) {
    remaining -= level * 100;
    level += 1;
  }
  return level;
}

async function ensureCatalog(tx = prisma) {
  for (const item of catalog) {
    await tx.gameItem.upsert({
      where: { slug: item.slug },
      update: { name: item.name, type: item.type, description: item.description, price: item.price, unlockLevel: item.unlockLevel, rarity: item.rarity, stats: item.stats, isStarter: item.isStarter },
      create: item,
    });
  }
}

async function ensureProfile(userId) {
  await ensureCatalog();
  const profile = await prisma.gameProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  const unlocks = await prisma.gameItem.findMany({ where: { OR: [{ isStarter: true }, { unlockLevel: { lte: profile.level }, price: 0 }] }, select: { id: true } });
  if (unlocks.length) {
    await prisma.gameInventory.createMany({ data: unlocks.map((item) => ({ userId, itemId: item.id })), skipDuplicates: true });
  }
  return profile;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionFor(request, reply) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "unauthorized", message: "Sign in with Discord to continue." });
    return null;
  }
  const token = header.slice(7);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) {
    reply.code(401).send({ error: "unauthorized", message: "Your session is invalid. Reconnect Discord." });
    return null;
  }
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, select: { userId: true, expiresAt: true } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
    reply.code(401).send({ error: "unauthorized", message: "Your session expired. Reconnect Discord." });
    return null;
  }
  return session;
}

async function gameProfilePayload(userId) {
  const profile = await ensureProfile(userId);
  const inventory = await prisma.gameInventory.findMany({ where: { userId }, include: { item: true }, orderBy: { acquiredAt: "asc" } });
  return {
    profile: {
      xp: profile.xp, level: profile.level, xpIntoLevel: profile.xp % 100,
      xpForNextLevel: profile.level * 100, coins: profile.coins,
      kills: profile.kills, deaths: profile.deaths, wins: profile.wins, losses: profile.losses,
      selectedCharacterId: profile.selectedCharacterId, selectedWeaponId: profile.selectedWeaponId,
    },
    inventory: inventory.map(({ item, acquiredAt }) => ({ ...item, acquiredAt })),
  };
}

const purchaseSchema = z.object({ itemId: z.string().min(1).max(80) }).strict();
const equipSchema = z.object({ itemId: z.string().min(1).max(80) }).strict();

export default async function gameRoutes(app) {
  app.get("/api/v1/game/catalog", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    await ensureCatalog();
    const items = await prisma.gameItem.findMany({ orderBy: [{ type: "asc" }, { unlockLevel: "asc" }, { price: "asc" }] });
    return { items };
  });

  app.get("/api/v1/game/profile", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await sessionFor(request, reply);
    if (!session) return;
    return gameProfilePayload(session.userId);
  });

  app.get("/api/v1/game/leaderboard", async (_request, reply) => {
    const profiles = await prisma.gameProfile.findMany({
      take: 10, orderBy: [{ wins: "desc" }, { kills: "desc" }, { xp: "desc" }],
      include: { user: { select: { username: true, displayName: true, avatar: true } } },
    });
    return { players: profiles.map(({ user, ...profile }) => ({ name: user.displayName || user.username, avatar: user.avatar, level: profile.level, xp: profile.xp, wins: profile.wins, kills: profile.kills })) };
  });

  app.post("/api/v1/game/shop/purchase", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const session = await sessionFor(request, reply);
    if (!session) return;
    const parsed = purchaseSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Choose a valid shop item." });
    await ensureCatalog();
    const profile = await ensureProfile(session.userId);
    const item = await prisma.gameItem.findUnique({ where: { slug: parsed.data.itemId } });
    if (!item || item.isStarter || item.price <= 0) return reply.code(404).send({ error: "item_not_for_sale", message: "That item is not available for purchase." });
    if (profile.level < item.unlockLevel) return reply.code(403).send({ error: "level_locked", message: `Reach level ${item.unlockLevel} to purchase this item.` });
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.gameInventory.findUnique({ where: { userId_itemId: { userId: session.userId, itemId: item.id } } });
        if (existing) return { alreadyOwned: true };
        const debit = await tx.gameProfile.updateMany({ where: { userId: session.userId, coins: { gte: item.price } }, data: { coins: { decrement: item.price } } });
        if (!debit.count) throw new Error("INSUFFICIENT_COINS");
        await tx.gameInventory.create({ data: { userId: session.userId, itemId: item.id } });
        return { alreadyOwned: false };
      });
      if (result.alreadyOwned) return reply.code(409).send({ error: "already_owned", message: "You already own this item." });
    } catch (error) {
      if (error?.message === "INSUFFICIENT_COINS") return reply.code(400).send({ error: "insufficient_coins", message: "You do not have enough coins for this item." });
      if (error?.code === "P2002") return reply.code(409).send({ error: "already_owned", message: "You already own this item." });
      throw error;
    }
    return { ...(await gameProfilePayload(session.userId)), message: `${item.name} purchased.` };
  });

  app.post("/api/v1/game/loadout", async (request, reply) => {
    const session = await sessionFor(request, reply);
    if (!session) return;
    const parsed = equipSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "Choose a valid item." });
    const inventory = await prisma.gameInventory.findFirst({ where: { userId: session.userId, item: { slug: parsed.data.itemId } }, include: { item: true } });
    if (!inventory) return reply.code(403).send({ error: "item_not_owned", message: "You must own an item before equipping it." });
    if (inventory.item.type === "SKIN") return reply.code(400).send({ error: "cosmetic_only", message: "This cosmetic can be owned, but this loadout slot is not available yet." });
    const data = inventory.item.type === "CHARACTER"
      ? { selectedCharacterId: inventory.item.slug }
      : { selectedWeaponId: inventory.item.slug };
    const profile = await prisma.gameProfile.update({ where: { userId: session.userId }, data });
    return { ...(await gameProfilePayload(session.userId)), message: `${inventory.item.name} equipped.`, selectedCharacterId: profile.selectedCharacterId, selectedWeaponId: profile.selectedWeaponId };
  });
}
