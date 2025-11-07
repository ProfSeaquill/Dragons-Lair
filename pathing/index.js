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

// One grid step per tick, with a lightweight visual tween between tiles.
export function updateAgent(enemy, /* dtSec, */ ctx) {
  if (!enemy || enemy.dead) return null;

  const tile = GRID.tile || 32;

  // Spawn FSM if needed
  if (!enemy._fsm) spawnAgent(enemy, ctx);

  // === Render tween state ===
  // enemy._lerp = { px, py, nx, ny, t, dur }
  const lerpFrames = ((GameState?.cfg?.tuning?.nav?.lerpFrames) ?? 6) | 0; // 4–8 looks good

  // If we are mid-tween, advance the interpolation and do NOT tick the FSM yet.
  if (enemy._lerp && enemy._lerp.t < enemy._lerp.dur) {
    enemy._lerp.t++;
    const a = enemy._lerp.t / enemy._lerp.dur;
    const ix = enemy._lerp.px + (enemy._lerp.nx - enemy._lerp.px) * a;
    const iy = enemy._lerp.py + (enemy._lerp.ny - enemy._lerp.py) * a;
    enemy.x = ix;
    enemy.y = iy;
    // Keep authoritative tile coords already set when the step began.
    return { moved: true, x: enemy.cx | 0, y: enemy.cy | 0, state: getFSMState(enemy._fsm) };
  }

  // === Begin a new tile step ===
  // Remember current pixel pos (start of tween)
  const startX = enemy.x ?? ((enemy.cx + 0.5) * tile);
  const startY = enemy.y ?? ((enemy.cy + 0.5) * tile);

  // Advance FSM exactly one tile
  const prevTx = enemy._fsm.x | 0, prevTy = enemy._fsm.y | 0;
  tickFSM(enemy._fsm);
  const nx = enemy._fsm.x | 0;
  const ny = enemy._fsm.y | 0;

  // Update authoritative tile coords immediately
  enemy.cx = nx; enemy.cy = ny;

  // Compute end pixel for tween
  const endX = (nx + 0.5) * tile;
  const endY = (ny + 0.5) * tile;

  // Initialize (or reset) tween
  enemy._lerp = { px: startX, py: startY, nx: endX, ny: endY, t: 0, dur: Math.max(1, lerpFrames) };

  // Put render position at the very start of the tween this frame
  enemy.x = startX;
  enemy.y = startY;

  // Optional: periodic peek (kept from your original)
  if ((enemy.__peekT = (enemy.__peekT ?? 0) + 1) % 60 === 0) {
    try {
      const st = getFSMState(enemy._fsm);
      console.log('[DIAG fsm]', { id: enemy.id, type: enemy.type, st, x: enemy._fsm.x, y: enemy._fsm.y });
    } catch {}
  }

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
