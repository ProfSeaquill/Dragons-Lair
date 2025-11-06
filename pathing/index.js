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
  // Accept either (x,y) or (cx,cy) conventions
  const x = (enemy.x ?? enemy.cx) | 0;
  const y = (enemy.y ?? enemy.cy) | 0;
  const seed = (enemy.seed ?? enemy.id ?? Math.random() * 0xFFFFFFFF) | 0;

  enemy._fsm = createAgent({ x, y, targetX: EXIT.x, targetY: EXIT.y, seed });
  return enemy._fsm;
}

export function despawnAgent(enemy /*, ctx */) {
  enemy._fsm = null;
}

// One grid step per tick (your game runs “1 tile per tick” movement)
export function updateAgent(enemy, /* dtSec, */ ctx) {
  if (!enemy || enemy.dead) return null;
  if (!enemy._fsm) spawnAgent(enemy, ctx);

  // Advance FSM exactly one tile
  tickFSM(enemy._fsm);

  // Write back integer tile coords; your render already reads enemy.{x|cx,y|cy}
  if ('cx' in enemy) { enemy.cx = enemy._fsm.x; enemy.cy = enemy._fsm.y; }
  else { enemy.x = enemy._fsm.x; enemy.y = enemy._fsm.y; }

  // Return a minimal movement report (optional)
  return { moved: true, x: enemy._fsm.x, y: enemy._fsm.y, state: getFSMState(enemy._fsm) };
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
