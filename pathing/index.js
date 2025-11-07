// pathing/index.js
// Thin façade that matches your existing imports, backed by our FSM.

import { createAgent, tick as tickFSM, getState as getFSMState } from './fsm.js';
import { planSegmentToFirstJunction } from './directpath.js';
import { buildTileRosters, renderOffsetNoOcc } from './separation.js';
import { EXIT, GRID, GameState } from '../state.js';

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

// One grid step when enough time has accumulated
export function updateAgent(enemy, dtSec = (state?.GameState?.dtSec ?? 1/60), ctx) {
  if (!enemy || enemy.dead) return null;
  if (!enemy._fsm) spawnAgent(enemy, ctx);

  // --- NEW: per-unit step pacing in tiles/sec ---
  // Try to read your tuned enemy speed if it exists; fall back to 1.0 tiles/sec.
  // (If you expose a better field name in your project, plug it in below.)
  const tilesPerSec =
    (enemy.speedTilesPerSec ?? enemy.speedTiles ?? enemy.tilesPerSec ?? 1.0);
  const stepPeriod = 1 / Math.max(0.001, tilesPerSec); // seconds per tile

  enemy._stepAcc = (enemy._stepAcc ?? 0) + dtSec;
  if (enemy._stepAcc < stepPeriod) {
    // Not time to advance a tile yet; keep pixel coords at current tile center
    const tile = GRID.tile || 32;
    enemy.x = (enemy.cx + 0.5) * tile;
    enemy.y = (enemy.cy + 0.5) * tile;
    return { moved: false, x: enemy.cx, y: enemy.cy, state: enemy._fsm?.state };
  }
  // Consume one step’s worth; if frame was long, keep a tiny remainder to stay smooth.
  enemy._stepAcc -= stepPeriod;

  // Advance exactly one tile in the FSM
  tickFSM(enemy._fsm);

  const tile = GRID.tile || 32;
  const nx = enemy._fsm.x | 0;
  const ny = enemy._fsm.y | 0;

  enemy.cx = nx; enemy.cy = ny;
  enemy.x = (nx + 0.5) * tile;
  enemy.y = (ny + 0.5) * tile;

  // periodic diag unchanged...
  return { moved: true, x: nx, y: ny, state: getFSMState(enemy._fsm) };
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
