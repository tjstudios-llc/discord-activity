export const ARENA_SIZE = Object.freeze({ width: 1600, height: 900 });
export const PLAYER_RADIUS = 22;
export const BULLET_RADIUS = 4;

const wall = (x, y, w, h, material = "metal") => Object.freeze({ x, y, w, h, material });
export const ARENAS = Object.freeze({
  foundry: Object.freeze({
    id: "foundry", name: "Foundry", subtitle: "Industrial combat zone", floor: "#0b1220", grid: "rgba(105,145,190,.11)",
    walls: Object.freeze([
      wall(250, 165, 150, 95), wall(625, 115, 210, 78), wall(1060, 170, 170, 110),
      wall(330, 600, 175, 105), wall(820, 620, 135, 115), wall(1245, 585, 145, 100),
      wall(730, 335, 140, 90), wall(90, 380, 95, 135), wall(1415, 365, 95, 135)
    ])
  }),
  desert: Object.freeze({
    id: "desert", name: "Desert Outpost", subtitle: "Long sightlines and rock cover", floor: "#201a16", grid: "rgba(236,179,108,.10)",
    walls: Object.freeze([
      wall(190, 150, 100, 150, "rock"), wall(470, 105, 180, 70), wall(840, 160, 95, 145, "rock"),
      wall(1190, 115, 205, 75), wall(320, 395, 130, 75), wall(690, 360, 220, 100),
      wall(1090, 405, 135, 80), wall(150, 660, 210, 75), wall(570, 640, 100, 135, "rock"),
      wall(990, 650, 200, 80), wall(1360, 630, 90, 130, "rock")
    ])
  }),
  neon: Object.freeze({
    id: "neon", name: "Neon Grid", subtitle: "Tight lanes and alternate routes", floor: "#0d1024", grid: "rgba(111,91,255,.15)",
    walls: Object.freeze([
      wall(210, 130, 250, 45, "neon"), wall(210, 130, 45, 175, "neon"), wall(470, 130, 45, 175, "neon"),
      wall(690, 120, 220, 70, "neon"), wall(1140, 130, 250, 45, "neon"), wall(1140, 130, 45, 175, "neon"),
      wall(1345, 130, 45, 175, "neon"), wall(300, 390, 170, 80, "neon"), wall(700, 340, 200, 150, "neon"),
      wall(1130, 390, 170, 80, "neon"), wall(210, 690, 250, 45, "neon"), wall(210, 590, 45, 145, "neon"),
      wall(470, 590, 45, 145, "neon"), wall(690, 690, 220, 70, "neon"), wall(1140, 690, 250, 45, "neon"),
      wall(1140, 590, 45, 145, "neon"), wall(1345, 590, 45, 145, "neon")
    ])
  }),
  arctic: Object.freeze({
    id: "arctic", name: "Arctic Base", subtitle: "Reinforced corridors and crate cover", floor: "#101d29", grid: "rgba(158,220,255,.12)",
    walls: Object.freeze([
      wall(210, 150, 170, 75), wall(450, 110, 95, 150), wall(1010, 110, 95, 150), wall(1220, 150, 170, 75),
      wall(170, 360, 220, 80), wall(490, 330, 105, 175), wall(1005, 330, 105, 175), wall(1210, 360, 220, 80),
      wall(650, 380, 105, 65), wall(845, 455, 105, 65), wall(230, 650, 130, 105), wall(500, 650, 190, 70),
      wall(910, 650, 190, 70), wall(1240, 635, 130, 105)
    ])
  })
});

export function getArena(mapId = "foundry") {
  return ARENAS[mapId] || ARENAS.foundry;
}

export function circleIntersectsRect(x, y, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy < radius * radius;
}

export function resolvePlayerMove(x, y, dx, dy, mapId = "foundry", radius = PLAYER_RADIUS) {
  const arena = getArena(mapId);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5));
  const stepX = dx / steps;
  const stepY = dy / steps;
  let nextX = x;
  let nextY = y;
  for (let i = 0; i < steps; i += 1) {
    const candidateX = Math.max(radius, Math.min(ARENA_SIZE.width - radius, nextX + stepX));
    if (!arena.walls.some((obstacle) => circleIntersectsRect(candidateX, nextY, radius, obstacle))) nextX = candidateX;
    const candidateY = Math.max(radius, Math.min(ARENA_SIZE.height - radius, nextY + stepY));
    if (!arena.walls.some((obstacle) => circleIntersectsRect(nextX, candidateY, radius, obstacle))) nextY = candidateY;
  }
  return { x: nextX, y: nextY };
}

export function segmentRectHit(x1, y1, x2, y2, rect, padding = 0) {
  const left = rect.x - padding;
  const right = rect.x + rect.w + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.h + padding;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let near = 0;
  let far = 1;
  for (const [origin, delta, min, max] of [[x1, dx, left, right], [y1, dy, top, bottom]]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return near >= 0 && near <= 1 ? near : null;
}

export function segmentCircleHit(x1, y1, x2, y2, cx, cy, radius) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lengthSquared));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return (cx - px) ** 2 + (cy - py) ** 2 <= radius * radius ? t : null;
}
