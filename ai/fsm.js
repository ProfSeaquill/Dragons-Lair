import { CFG } from './config.js';
import * as S_search from './states/search.js';
import * as S_decision from './states/decision.js';
import * as S_charge from './states/charge.js';
import * as S_fear from './states/fear.js';
import { initMemory, markVisited } from './memory.js';
import { tileId } from './steering.js';
import { isJunction } from './perception.js';

const STATES = {
  search: S_search,
  decision: S_decision,
  charge: S_charge,
  fear: S_fear,
};

export function initEnemyForFSM(e) {
  e.state ??= 'search';
  e.stateT = 0;
  e.speedMul = 1;
  initMemory(e);
}

export function stepEnemyFSM(gs, e, dt) {
  // ——— Priority arbitration (global) ———
  // 1) Charge if dragon in sight
  // 2) Decision if at a junction and no commit left
  // 3) Fear if under effect
  // 4) Otherwise Search
  // But execution runs through current state's update to keep continuity.
  const pri = CFG.PRI;

  // Compute “candidates”
  const candidates = [];
  if (e.fearT > 0) candidates.push('fear');
  if (isJunction(gs.grid, e.tileX, e.tileY) && e.commitTilesLeft <= 0) candidates.push('decision');
  if (/* lightweight check here; heavy LOS lives in search state update too */ false) candidates.push('charge');

  // Force Decision > Fear
  candidates.sort((a,b)=>pri[b]-pri[a]);
  const top = candidates[0] || e.state;

  // State transition if priority demands (except allow current state if same or higher)
  if (pri[top] > pri[e.state]) changeState(e, gs, top);

  // Mark visited tiles at centers
  if ((e.x % gs.tileSize === 0) && (e.y % gs.tileSize === 0)) {
    markVisited(e, tileId(e.tileX, e.tileY), gs.time.now);
  }

  // Run state logic
  const impl = STATES[e.state];
  const next = impl.update(e, gs, dt);
  if (next && next !== e.state) changeState(e, gs, next);
}

function changeState(e, gs, to) {
  e.stateT = 0;
  // Track lastNonFearState
  if (e.state !== 'fear' && to === 'fear') e.lastNonFearState = e.state;
  e.state = to;
  const impl = STATES[e.state];
  if (impl && impl.enter) impl.enter(e, gs);
}
