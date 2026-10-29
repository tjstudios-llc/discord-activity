import test from "node:test";
import assert from "node:assert/strict";
import { ARENAS, getArena, resolvePlayerMove, segmentRectHit, segmentCircleHit, circleIntersectsRect } from "./index.js";

test("all four maps have names, walls, and in-bounds geometry", () => {
  assert.equal(Object.keys(ARENAS).length, 4);
  for (const arena of Object.values(ARENAS)) {
    assert.ok(arena.name);
    assert.ok(arena.walls.length >= 6);
    for (const wall of arena.walls) {
      assert.ok(wall.x >= 0 && wall.y >= 0);
      assert.ok(wall.w > 0 && wall.h > 0);
      assert.ok(wall.x + wall.w <= 1600 && wall.y + wall.h <= 900);
    }
  }
});

test("unknown map ids safely resolve to Foundry", () => {
  assert.equal(getArena("missing").id, "foundry");
});

test("player cannot pass through a wall and can slide along it", () => {
  const start = { x: 220, y: 210 };
  const moved = resolvePlayerMove(start.x, start.y, 70, 25, "foundry");
  assert.ok(moved.x < 250 - 22 + 1);
  assert.ok(moved.y > start.y);
  assert.ok(!circleIntersectsRect(moved.x, moved.y, 22, getArena("foundry").walls[0]));
});

test("high-speed movement does not tunnel through a thin wall", () => {
  const moved = resolvePlayerMove(150, 210, 220, 0, "foundry");
  assert.ok(moved.x < 250 - 22 + 1);
});

test("bullet segment detects wall before target behind it", () => {
  const arena = getArena("foundry");
  const wall = arena.walls[0];
  const wallT = segmentRectHit(200, 210, 600, 210, wall, 4);
  const targetT = segmentCircleHit(200, 210, 600, 210, 500, 210, 22);
  assert.notEqual(wallT, null);
  assert.notEqual(targetT, null);
  assert.ok(wallT < targetT);
});

test("unobstructed bullet segment can hit a target", () => {
  assert.equal(segmentRectHit(450, 300, 600, 300, getArena("foundry").walls[0], 4), null);
  assert.notEqual(segmentCircleHit(450, 300, 600, 300, 550, 300, 22), null);
});

test("corner collision prevents entering solid cover", () => {
  const wall = getArena("foundry").walls[0];
  const moved = resolvePlayerMove(wall.x - 35, wall.y - 35, 20, 20, "foundry");
  assert.ok(!circleIntersectsRect(moved.x, moved.y, 22, wall));
});
