import { createHash } from "node:crypto";
import { Room, Server } from "colyseus";
import { prisma } from "@teamspace/database";
import { ARENA_SIZE, PLAYER_RADIUS, BULLET_RADIUS, getArena, resolvePlayerMove, circleIntersectsRect, segmentRectHit, segmentCircleHit } from "@teamspace/game-core";

const port = Number.parseInt(process.env.REALTIME_PORT ?? "2567", 10);
const MATCH_DURATION_MS = 180_000;
const ARENA = ARENA_SIZE;
const TICK_MS = 50;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("REALTIME_PORT must be a valid TCP port");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
function chooseSpawn(mapId, team, players) {
  const arena = getArena(mapId);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const x = team === "red" ? 90 + Math.random() * 520 : team === "blue" ? 990 + Math.random() * 520 : 70 + Math.random() * 1460;
    const y = 70 + Math.random() * 760;
    if (arena.walls.some((obstacle) => circleIntersectsRect(x, y, PLAYER_RADIUS, obstacle))) continue;
    if (players.some((player) => player.health > 0 && Math.hypot(player.x - x, player.y - y) < PLAYER_RADIUS * 2.5)) continue;
    return { x, y };
  }
  for (let y = 60; y < ARENA.height - 60; y += 55) {
    for (let x = 60; x < ARENA.width - 60; x += 55) {
      if (!arena.walls.some((obstacle) => circleIntersectsRect(x, y, PLAYER_RADIUS, obstacle)) &&
          !players.some((player) => player.health > 0 && Math.hypot(player.x - x, player.y - y) < PLAYER_RADIUS * 2.5)) return { x, y };
    }
  }
  return { x: team === "red" ? 90 : ARENA.width - 90, y: ARENA.height / 2 };
}
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
    this.mapId = getArena(options.mapId).id;
    this.players = new Map(); this.bullets = []; this.startedAt = Date.now(); this.ended = false;
    this.matchRecord = await prisma.gameMatch.create({ data: { mode: this.mode, status: "ACTIVE" } });
    this.setMetadata({ mode: this.mode.toLowerCase(), mapId: this.mapId, mapName: getArena(this.mapId).name, title: this.mode === "TEAM" ? "Team Battle" : "Free-for-all" });
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
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } });
    const character = await prisma.gameItem.findUnique({ where: { slug: profile.selectedCharacterId } });
    const weapon = await prisma.gameItem.findUnique({ where: { slug: profile.selectedWeaponId } });
    const index = this.players.size;
    const team = this.mode === "TEAM" ? (index % 2 ? "blue" : "red") : null;
    const spawn = chooseSpawn(this.mapId, team, [...this.players.values()]);
    this.players.set(client.sessionId, { sessionId: client.sessionId, userId, joinedAt: Date.now(), name: user?.displayName || user?.username || ("Player " + (index + 1)), x: spawn.x, y: spawn.y, aimX: 1, aimY: 0, health: Number(character?.stats?.health) || 100, maxHealth: Number(character?.stats?.health) || 100, speed: Number(character?.stats?.speed) * 180 || 180, color: character?.stats?.color || (index % 2 ? "#ff718b" : "#62e6c5"), weapon: { damage: Number(weapon?.stats?.damage) || 25, cooldown: Number(weapon?.stats?.cooldown) || 0.32, speed: Number(weapon?.stats?.speed) || 540 }, team, kills: 0, deaths: 0, lastShot: 0, respawnAt: 0, input: { x: 0, y: 0, fire: false } });
    client.send("welcome", { matchId: this.matchRecord.id, mode: this.mode.toLowerCase(), mapId: this.mapId, mapName: getArena(this.mapId).name, playerId: client.sessionId, arena: ARENA, durationMs: MATCH_DURATION_MS });
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
      if (player.health <= 0) { if (now >= player.respawnAt) { player.health = player.maxHealth; const spawn = chooseSpawn(this.mapId, player.team, [...this.players.values()].filter((other) => other.sessionId !== player.sessionId)); player.x = spawn.x; player.y = spawn.y; } continue; }
      const length = Math.hypot(player.input.x, player.input.y) || 1;
      const movement = resolvePlayerMove(player.x, player.y, player.input.x / length * player.speed * dt, player.input.y / length * player.speed * dt, this.mapId, PLAYER_RADIUS);
      player.x = movement.x;
      player.y = movement.y;
      if (player.input.fire && now - player.lastShot >= player.weapon.cooldown * 1000) { player.lastShot = now; this.bullets.push({ id: player.sessionId + "-" + now, owner: player.sessionId, x: player.x + player.aimX * 24, y: player.y + player.aimY * 24, vx: player.aimX * player.weapon.speed, vy: player.aimY * player.weapon.speed, damage: player.weapon.damage, ttl: 1.4 }); }
    }
    const remaining = [];
    const walls = getArena(this.mapId).walls;
    for (const bullet of this.bullets) {
      const startX = bullet.x, startY = bullet.y;
      const endX = startX + bullet.vx * dt, endY = startY + bullet.vy * dt;
      bullet.ttl -= dt;
      if (bullet.ttl <= 0 || endX < 0 || endY < 0 || endX > ARENA.width || endY > ARENA.height) continue;

      let nearestWallT = null;
      for (const obstacle of walls) {
        const t = segmentRectHit(startX, startY, endX, endY, obstacle, BULLET_RADIUS);
        if (t !== null && (nearestWallT === null || t < nearestWallT)) nearestWallT = t;
      }

      let nearestTarget = null;
      let nearestTargetT = Infinity;
      for (const target of this.players.values()) {
        if (target.sessionId === bullet.owner || target.health <= 0) continue;
        const shooter = this.players.get(bullet.owner);
        if (this.mode === "TEAM" && shooter?.team && shooter.team === target.team) continue;
        const t = segmentCircleHit(startX, startY, endX, endY, target.x, target.y, PLAYER_RADIUS + BULLET_RADIUS);
        if (t !== null && t < nearestTargetT) { nearestTarget = target; nearestTargetT = t; }
      }

      // Solid cover wins when it is at or before the first player intersection.
      if (nearestWallT !== null && (nearestTarget === null || nearestWallT <= nearestTargetT)) continue;
      if (nearestTarget) {
        const shooter = this.players.get(bullet.owner);
        nearestTarget.health = Math.max(0, nearestTarget.health - bullet.damage);
        if (nearestTarget.health === 0) {
          nearestTarget.deaths += 1;
          nearestTarget.respawnAt = now + 1300;
          if (shooter) shooter.kills += 1;
        }
        continue;
      }
      bullet.x = endX; bullet.y = endY;
      remaining.push(bullet);
    }
    this.bullets = remaining;
    const snapshot = { mode: this.mode.toLowerCase(), mapId: this.mapId, mapName: getArena(this.mapId).name, elapsedMs: now - this.startedAt, remainingMs: Math.max(0, MATCH_DURATION_MS - (now - this.startedAt)), players: [...this.players.values()].map(({ sessionId, name, x, y, aimX, aimY, health, maxHealth, color, team, kills, deaths }) => ({ id: sessionId, name, x, y, aimX, aimY, health, maxHealth, color, team, kills, deaths, isSelf: false })), bullets: this.bullets.map(({ id, owner, x, y }) => ({ id, owner, x, y })), scores: this.scoreboard() };
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
        const participated = Date.now() - player.joinedAt >= 60_000;
        const xpEarned = (participated ? 100 : 0) + player.kills * 20 + (won ? 50 : 0), coinsEarned = (participated ? 25 : 0) + player.kills * 5 + (won ? 25 : 0);
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
server.define("arena", ArenaRoom).filterBy(["mode", "mapId"]);
server.onShutdown(async () => { console.info("PvP realtime service stopping"); await prisma.$disconnect(); });
await server.listen(port);
console.info("PvP realtime service listening on port " + port);
