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
  if (!enemy._fsm) spawnAgent(enemy, ctx);

  // Advance FSM one grid step
  tickFSM(enemy._fsm);

  const tile = GRID.tile || 32;
  const nx = enemy._fsm.x | 0;
  const ny = enemy._fsm.y | 0;

  // Authoritative tiles:
  enemy.cx = nx; enemy.cy = ny;

  // Target pixel (tile center)
  const tx = (nx + 0.5) * tile;
  const ty = (ny + 0.5) * tile;

  // Initialize draw coords once
  if (enemy.drawX == null) enemy.drawX = enemy.x ?? tx;
  if (enemy.drawY == null) enemy.drawY = enemy.y ?? ty;

  // Update the "true" x/y immediately (for hit tests, ranges, etc.)
  enemy.x = tx; 
  enemy.y = ty;

  // Ease draw position toward target for smooth motion
  const LERP = 0.35; // tweak 0.25..0.5 to taste
  enemy.drawX += (tx - enemy.drawX) * LERP;
  enemy.drawY += (ty - enemy.drawY) * LERP;

  // (Renderer: use drawX/drawY when drawing sprites/circles)
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
