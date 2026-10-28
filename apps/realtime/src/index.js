import { createHash } from "node:crypto";
import { Room, Server } from "colyseus";
import { prisma } from "@teamspace/database";

const port = Number.parseInt(process.env.REALTIME_PORT ?? "2567", 10);
const MATCH_DURATION_MS = 180_000;
const ARENA = { width: 1600, height: 900 };
const TICK_MS = 50;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("REALTIME_PORT must be a valid TCP port");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
function levelForXp(xp) { let level = 1; let remaining = Math.max(0, xp); while (remaining >= level * 100) { remaining -= level * 100; level += 1; } return level; }

class ArenaRoom extends Room {
  static async onAuth(token, options = {}) {
    const sessionToken = typeof token === "string" ? token : options?.token;
    if (typeof sessionToken !== "string" || !/^[A-Za-z0-9_-]{40,}$/.test(sessionToken)) throw new Error("A valid Discord game session is required");
    const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(sessionToken) }, select: { userId: true, expiresAt: true } });
    if (!session || session.expiresAt <= new Date()) throw new Error("Your game session has expired");
    return { userId: session.userId };
  }
  async onCreate(options = {}) {
    this.mode = options.mode === "team" ? "TEAM" : "FREE_FOR_ALL";
    this.players = new Map(); this.bullets = []; this.startedAt = Date.now(); this.ended = false;
    this.matchRecord = await prisma.gameMatch.create({ data: { mode: this.mode, status: "ACTIVE" } });
    this.setMetadata({ mode: this.mode.toLowerCase(), title: this.mode === "TEAM" ? "Team Battle" : "Free-for-all" });
    this.maxClients = 8;
    this.onMessage("input", (client, payload) => this.applyInput(client, payload));
    this.onMessage("leave-match", (client) => client.leave());
    this.tick = setInterval(() => this.simulate(), TICK_MS);
    this.endTimer = setTimeout(() => { void this.finishMatch(); }, MATCH_DURATION_MS);
  }
  async onJoin(client, options = {}, auth = {}) {
    let userId = auth?.userId;
    if (!userId && typeof options?.token === "string") {
      const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(options.token) }, select: { userId: true, expiresAt: true } });
      if (session && session.expiresAt > new Date()) userId = session.userId;
    }
    if (!userId) return client.leave(4001, "Discord session expired");
    await this.addPlayer(client, userId);
  }
  async addPlayer(client, userId) {
    if (this.ended) return client.leave(4002, "This match has ended");
    const profile = await prisma.gameProfile.upsert({ where: { userId }, update: {}, create: { userId } });
    const character = await prisma.gameItem.findUnique({ where: { slug: profile.selectedCharacterId } });
    const weapon = await prisma.gameItem.findUnique({ where: { slug: profile.selectedWeaponId } });
    const index = this.players.size;
    this.players.set(client.sessionId, { sessionId: client.sessionId, userId, name: "Player " + (index + 1), x: this.mode === "TEAM" ? (index % 2 ? 1320 : 280) : 200 + Math.random() * 1200, y: 150 + Math.random() * 600, aimX: 1, aimY: 0, health: 100, maxHealth: 100, speed: Number(character?.stats?.speed) * 180 || 180, color: character?.stats?.color || (index % 2 ? "#ff718b" : "#62e6c5"), weapon: { damage: Number(weapon?.stats?.damage) || 25, cooldown: Number(weapon?.stats?.cooldown) || 0.32, speed: Number(weapon?.stats?.speed) || 540 }, team: this.mode === "TEAM" ? (index % 2 ? "blue" : "red") : null, kills: 0, deaths: 0, lastShot: 0, respawnAt: 0, input: { x: 0, y: 0, fire: false } });
    client.send("welcome", { matchId: this.matchRecord.id, mode: this.mode.toLowerCase(), playerId: client.sessionId, arena: ARENA, durationMs: MATCH_DURATION_MS });
  }
  applyInput(client, payload) {
    const player = this.players.get(client.sessionId); if (!player || this.ended || !payload || typeof payload !== "object") return;
    const clamp = (value) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    player.input = { x: clamp(payload.x), y: clamp(payload.y), fire: payload.fire === true };
    const ax = Number(payload.aimX), ay = Number(payload.aimY);
    if (Number.isFinite(ax) && Number.isFinite(ay)) { const length = Math.hypot(ax, ay) || 1; player.aimX = ax / length; player.aimY = ay / length; }
  }
  simulate() {
    if (this.ended) return; const now = Date.now(), dt = TICK_MS / 1000;
    for (const player of this.players.values()) {
      if (player.health <= 0) { if (now >= player.respawnAt) { player.health = player.maxHealth; player.x = 150 + Math.random() * (ARENA.width - 300); player.y = 120 + Math.random() * (ARENA.height - 240); } continue; }
      const length = Math.hypot(player.input.x, player.input.y) || 1;
      player.x = Math.max(30, Math.min(ARENA.width - 30, player.x + player.input.x / length * player.speed * dt));
      player.y = Math.max(30, Math.min(ARENA.height - 30, player.y + player.input.y / length * player.speed * dt));
      if (player.input.fire && now - player.lastShot >= player.weapon.cooldown * 1000) { player.lastShot = now; this.bullets.push({ id: player.sessionId + "-" + now, owner: player.sessionId, x: player.x + player.aimX * 24, y: player.y + player.aimY * 24, vx: player.aimX * player.weapon.speed, vy: player.aimY * player.weapon.speed, damage: player.weapon.damage, ttl: 1.4 }); }
    }
    const remaining = [];
    for (const bullet of this.bullets) {
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.ttl -= dt;
      if (bullet.ttl <= 0 || bullet.x < 0 || bullet.y < 0 || bullet.x > ARENA.width || bullet.y > ARENA.height) continue;
      let hit = false;
      for (const target of this.players.values()) {
        if (target.sessionId === bullet.owner || target.health <= 0) continue;
        const shooter = this.players.get(bullet.owner); if (this.mode === "TEAM" && shooter?.team && shooter.team === target.team) continue;
        if (Math.hypot(target.x - bullet.x, target.y - bullet.y) < 22) { target.health = Math.max(0, target.health - bullet.damage); if (target.health === 0) { target.deaths += 1; target.respawnAt = now + 1300; if (shooter) shooter.kills += 1; } hit = true; break; }
      }
      if (!hit) remaining.push(bullet);
    }
    this.bullets = remaining;
    const snapshot = { mode: this.mode.toLowerCase(), elapsedMs: now - this.startedAt, remainingMs: Math.max(0, MATCH_DURATION_MS - (now - this.startedAt)), players: [...this.players.values()].map(({ sessionId, name, x, y, aimX, aimY, health, maxHealth, color, team, kills, deaths }) => ({ id: sessionId, name, x, y, aimX, aimY, health, maxHealth, color, team, kills, deaths, isSelf: false })), bullets: this.bullets.map(({ id, owner, x, y }) => ({ id, owner, x, y })), scores: this.scoreboard() };
    for (const client of this.clients) client.send("snapshot", { ...snapshot, players: snapshot.players.map((player) => ({ ...player, isSelf: player.id === client.sessionId })) });
  }
  scoreboard() { const scores = { red: 0, blue: 0 }; if (this.mode === "TEAM") for (const player of this.players.values()) if (player.team) scores[player.team] += player.kills; return scores; }
  async finishMatch() {
    if (this.ended) return; this.ended = true; clearInterval(this.tick); clearTimeout(this.endTimer);
    const players = [...this.players.values()], scores = this.scoreboard();
    const winningTeam = this.mode === "TEAM" ? (scores.red === scores.blue ? null : scores.red > scores.blue ? "red" : "blue") : null;
    const ffaWinner = this.mode === "FREE_FOR_ALL" ? [...players].sort((a, b) => b.kills - a.kills)[0]?.sessionId : null;
    const ranked = [...players].sort((a, b) => b.kills - a.kills);
    await prisma.$transaction(async (tx) => {
      await tx.gameMatch.update({ where: { id: this.matchRecord.id }, data: { status: "COMPLETED", endedAt: new Date() } });
      for (const [index, player] of ranked.entries()) {
        const won = this.mode === "TEAM" ? winningTeam !== null && player.team === winningTeam : player.sessionId === ffaWinner;
        const xpEarned = 100 + player.kills * 20 + (won ? 50 : 0), coinsEarned = 25 + player.kills * 5 + (won ? 25 : 0);
        await tx.gameMatchPlayer.upsert({ where: { matchId_userId: { matchId: this.matchRecord.id, userId: player.userId } }, update: { team: player.team, kills: player.kills, deaths: player.deaths, placement: index + 1, xpEarned, coinsEarned }, create: { matchId: this.matchRecord.id, userId: player.userId, team: player.team, kills: player.kills, deaths: player.deaths, placement: index + 1, xpEarned, coinsEarned } });
        const profile = await tx.gameProfile.upsert({ where: { userId: player.userId }, update: { xp: { increment: xpEarned }, coins: { increment: coinsEarned }, kills: { increment: player.kills }, deaths: { increment: player.deaths }, wins: { increment: won ? 1 : 0 }, losses: { increment: won ? 0 : 1 } }, create: { userId: player.userId, xp: xpEarned, coins: 150 + coinsEarned, kills: player.kills, deaths: player.deaths, wins: won ? 1 : 0, losses: won ? 0 : 1 } });
        const level = levelForXp(profile.xp); await tx.gameProfile.update({ where: { userId: player.userId }, data: { level } });
        const rewardItems = await tx.gameItem.findMany({ where: { unlockLevel: { lte: level }, price: 0 }, select: { id: true } });
        if (rewardItems.length) await tx.gameInventory.createMany({ data: rewardItems.map((item) => ({ userId: player.userId, itemId: item.id })), skipDuplicates: true });
      }
    });
    for (const client of this.clients) client.send("match-ended", { mode: this.mode.toLowerCase(), scores, winner: this.mode === "TEAM" ? winningTeam : ffaWinner, message: "Match complete! Your XP and coins have been saved." });
    this.clock.setTimeout(() => this.disconnect(), 5000);
  }
  async onLeave(client) { const player = this.players.get(client.sessionId); if (player) { player.input = { x: 0, y: 0, fire: false }; player.disconnected = true; } }
  async onDispose() { clearInterval(this.tick); clearTimeout(this.endTimer); if (!this.ended && this.matchRecord) await prisma.gameMatch.updateMany({ where: { id: this.matchRecord.id, status: "ACTIVE" }, data: { status: "COMPLETED", endedAt: new Date() } }); }
}
const server = new Server();
server.define("arena", ArenaRoom).filterBy(["mode"]);
server.onShutdown(async () => { console.info("PvP realtime service stopping"); await prisma.$disconnect(); });
await server.listen(port);
console.info("PvP realtime service listening on port " + port);
