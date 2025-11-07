// pathing/index.js
// Thin façade that matches your existing imports, backed by our FSM.

import { createAgent, tick as tickFSM, getState as getFSMState } from './fsm.js';
import { planSegmentToFirstJunction } from './directpath.js';
import { buildTileRosters, renderOffsetNoOcc } from './separation.js';
import { EXIT, GRID } from '../state.js';

// Optional context bag (kept for parity with your old initPathing signature)
export function initPathing(/*gridApi, exit, opts*/) {
  return { ok: true };
}

// Spawn/Despawn simply attach/detach an FSM agent on your enemy object.
export function spawnAgent(enemy /*, ctx */) {
  // Prefer tile coords; derive from pixels only if needed.
  const tile = GRID.tile || 32;
  const sx = Number.isInteger(enemy.cx)
    ? enemy.cx
    : Number.isFinite(enemy.x) ? Math.floor(enemy.x / tile) : EXIT.x;
  const sy = Number.isInteger(enemy.cy)
    ? enemy.cy
    : Number.isFinite(enemy.y) ? Math.floor(enemy.y / tile) : EXIT.y;

  const seed = (enemy.seed ?? enemy.id ?? (Math.random() * 0xFFFFFFFF)) | 0;

  enemy._fsm = createAgent({ x: sx, y: sy, targetX: EXIT.x, targetY: EXIT.y, seed });

  // Keep enemy.cx/cy authoritative; snap pixels to tile center for render
  enemy.cx = sx; enemy.cy = sy;
  enemy.x  = (sx + 0.5) * tile;
  enemy.y  = (sy + 0.5) * tile;

  return enemy._fsm;
}

export function despawnAgent(enemy /*, ctx */) {
  enemy._fsm = null;
}

// One grid step per tick (your game runs “1 tile per tick” movement)
export function updateAgent(enemy, dtSec = 0, ctx) {
  if (!enemy || enemy.dead) return null;
  if (!enemy._fsm) spawnAgent(enemy, ctx);

  const tile = GRID.tile || 32;

  // Normalize speed (px/sec) with broad compatibility
  const pxPerSec =
    (typeof enemy.pxPerSec === 'number' && enemy.pxPerSec > 0) ? enemy.pxPerSec :
    (typeof enemy.speedPx  === 'number' && enemy.speedPx  > 0) ? enemy.speedPx  :
    (typeof enemy.speed    === 'number' && enemy.speed    > 0) ? (enemy.speed * tile) :
    80;

  // Accumulate pixel distance; convert to whole-tile steps
  enemy._distAcc = (enemy._distAcc || 0) + (pxPerSec * (dtSec || 0));
  let steps = 0;
  if (enemy._distAcc >= tile) {
    steps = Math.floor(enemy._distAcc / tile);
    enemy._distAcc -= steps * tile;
  }
  // Ensure progress on zero-dt update cycles
  if (!dtSec && steps === 0) steps = 1;

  let moved = false;
  for (let i = 0; i < steps; i++) {
    const bx = enemy._fsm.x | 0, by = enemy._fsm.y | 0;
    tickFSM(enemy._fsm);
    const ax = enemy._fsm.x | 0, ay = enemy._fsm.y | 0;
    if (ax !== bx || ay !== by) moved = true;
  }

  const nx = enemy._fsm.x | 0;
  const ny = enemy._fsm.y | 0;

  // Authoritative tiles:
  enemy.cx = nx; enemy.cy = ny;

  // Pixel center (renderer may add sub-tile offset visually)
  enemy.x = (nx + 0.5) * tile;
  enemy.y = (ny + 0.5) * tile;

  // Return both old/common shapes to be 100% safe:
  return {
    moved,
    nx, ny,           // explicit next tile
    x: nx, y: ny,     // legacy tile alias
    state: getFSMState(enemy._fsm)
  };
}



// Visual-only sub-tile offset (separation.js, no occupancy)
let __rosters = null;
export function beginRenderBatch(units) {
  __rosters = buildTileRosters(units || []);
}
export function endRenderBatch() { __rosters = null; }

export function renderOffset(agentOrEnemy, /* ctx, */ tileSize = GRID.tile) {
  const unit = {
    id: agentOrEnemy.id ?? agentOrEnemy._id ?? agentOrEnemy,
    x: ('cx' in agentOrEnemy ? agentOrEnemy.cx : agentOrEnemy.x) | 0,
    y: ('cy' in agentOrEnemy ? agentOrEnemy.cy : agentOrEnemy.y) | 0,
  };
  // If caller didn’t call beginRenderBatch, fall back to no offset
  if (!__rosters) return [0, 0];
  return renderOffsetNoOcc(unit, __rosters, tileSize, { maxOffsetRatio: 0.22 });
}

// Optional: expose a segment planner if you want to draw debug paths
export { planSegmentToFirstJunction };
