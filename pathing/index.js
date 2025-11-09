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

// --- Stage 1b: choose a goal in the attack band (west of dragon) ---
function __attackBandGoal(gs) {
  // Use your existing dragon footprint helpers
  const cells = (typeof state?.dragonCells === 'function')
    ? state.dragonCells(gs)
    : []; // fallback empty

  if (!cells.length) {
    // Fallback to EXIT-1 when footprint isn’t ready yet
    return { gx: EXIT.x - 1, gy: EXIT.y };
  }

  // Find west face (min x) and the vertical span
  let minX = Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) { 
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const bandX = Math.max(0, (minX|0) - 1);
  const midY  = (minY + maxY) >> 1;

  // Prefer center of the 3-tile band; if out of bounds, clamp
  const gy = Math.max(0, Math.min(GRID.rows - 1, midY));
  return { gx: bandX, gy };
}

// NOTE: pooled enemies carry FSM smoother fields (_fromPX/_toPX/_stepAcc).
// Always re-seed them here, or they will render at last wave's death pixel for a frame.
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

  // ⛳ Reset the pathing smoother so pooled objects don’t carry stale draw state
  enemy._fromPX = enemy.x;
  enemy._fromPY = enemy.y;
  enemy._toPX   = enemy.x;
  enemy._toPY   = enemy.y;
  enemy._stepAcc = 0;
  enemy.drawX   = enemy.x;
  enemy.drawY   = enemy.y;

  return enemy._fsm;
}


export function despawnAgent(enemy /*, ctx */) {
  enemy._fsm = null;
}

// One grid step when enough time has accumulated
export function updateAgent(enemy, dtSec = ((GameState && GameState.dtSec) || 1/60), ctx) {
  if (!enemy || enemy.dead) return null;
  if (!enemy._fsm) spawnAgent(enemy, ctx);

  // --- pacing unchanged ---
  const tilesPerSec = (enemy.speedTilesPerSec ?? enemy.speedTiles ?? enemy.tilesPerSec ?? 1.0);
  const stepPeriod = 1 / Math.max(0.001, tilesPerSec);

  const tile = GRID.tile || 32;

  // Initialize interpolation endpoints once
  if (enemy._fromPX == null) {
    const px = ((enemy.cx ?? 0) + 0.5) * tile;
    const py = ((enemy.cy ?? 0) + 0.5) * tile;
    enemy._fromPX = px; enemy._fromPY = py;
    enemy._toPX   = px; enemy._toPY   = py;
    enemy.drawX   = px; enemy.drawY   = py;
  }

  // Accumulate time since last grid step
  enemy._stepAcc = (enemy._stepAcc ?? 0) + dtSec;

  if (enemy._stepAcc >= stepPeriod) {
    // We owe exactly ONE grid step; preserve remainder for smoothness
    enemy._stepAcc -= stepPeriod;

    // Keep previous "to" as new "from"
    enemy._fromPX = enemy._toPX;
    enemy._fromPY = enemy._toPY;

    // Advance FSM exactly one tile
    const prevCx = enemy.cx | 0;
    const prevCy = enemy.cy | 0;
    tickFSM(enemy._fsm);
    const nx = enemy._fsm.x | 0;
    const ny = enemy._fsm.y | 0;

    // Authoritative grid coords and logic-center pixels
    enemy.cx = nx; enemy.cy = ny;
    enemy.x  = (nx + 0.5) * tile;
    enemy.y  = (ny + 0.5) * tile;

    // New interpolation target
    enemy._toPX = enemy.x;
    enemy._toPY = enemy.y;
  }

  // Interpolate draw position based on time since last step
  const t = Math.max(0, Math.min(1, enemy._stepAcc / stepPeriod)); // 0..1
  enemy.drawX = enemy._fromPX + (enemy._toPX - enemy._fromPX) * t;
  enemy.drawY = enemy._fromPY + (enemy._toPY - enemy._fromPY) * t;

  // (Renderer: draw at drawX/drawY; logic continues to use x/y, cx/cy)
  return { moved: true, x: enemy.cx | 0, y: enemy.cy | 0, state: getFSMState(enemy._fsm) };
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
