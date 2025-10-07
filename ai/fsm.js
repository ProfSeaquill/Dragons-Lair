import { CFG } from './config.js';
import * as S_search from './states/search.js';
import * as S_decision from './states/decision.js';
import * as S_charge from './states/charge.js';
import * as S_fear from './states/fear.js';
import { initMemory, markVisited } from './memory.js';
import { tileId } from './steering.js';
import { isJunction } from './perception.js';

// --- Safety helpers ---
const hasState = (s) => !!STATES[s];
const priOf = (pri, k) => (Number.isFinite(pri?.[k]) ? pri[k] : -Infinity);

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
    // Ensure we always have a valid state (guards against uninitialized enemies)
  if (!hasState(e.state)) {
    initEnemyForFSM(e);           // sets e.state='search', e.stateT=0, speedMul, memory
  }

  const pri = CFG.PRI;

  // Compute “candidates”
  const candidates = [];
  if (e.fearT > 0) candidates.push('fear');
  if (isJunction(gs.grid, e.tileX, e.tileY) && e.commitTilesLeft <= 0) candidates.push('decision');
  if (/* lightweight check here; heavy LOS lives in search state update too */ false) candidates.push('charge');

  // Force Decision > Fear
  candidates.sort((a, b) => priOf(pri, b) - priOf(pri, a));
  const top = candidates[0] || e.state || 'search';


  // State transition if priority demands (except allow current state if same or higher)
  if (priOf(pri, top) > priOf(pri, e.state)) changeState(e, gs, top);

  // Mark visited tiles at centers
  if ((e.x % gs.tileSize === 0) && (e.y % gs.tileSize === 0)) {
    markVisited(e, tileId(e.tileX, e.tileY), gs.time.now);
  }

  // Run state logic
    const impl = STATES[e.state] || STATES.search;
  if (!impl || typeof impl.update !== 'function') {
    // Defensive: don’t crash if a state module forgot to export update()
    // (Log once per enemy/state pair if you want; keeping it silent here.)
    return;
  }
  const next = impl.update(e, gs, dt);
  if (next && next !== e.state) changeState(e, gs, next);
}

function changeState(e, gs, to) {
  const nextState = hasState(to) ? to : 'search';
  e.stateT = 0;
  if (e.state !== 'fear' && nextState === 'fear') e.lastNonFearState = e.state;
  e.state = nextState;
  const impl = STATES[e.state];
  if (impl && typeof impl.enter === 'function') impl.enter(e, gs);
}
