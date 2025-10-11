import { CFG } from './config.js';
import * as S_search from './states/search.js';
import * as S_decision from './states/decision.js';
import * as S_charge from './states/charge.js';
import * as S_fear from './states/fear.js';
import { initMemory } from './memory.js';
import { tileId } from './steering.js';
import { isJunction } from './perception.js';
import * as state from '../state.js';

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
  e.jxnStack ??= [];
  e.backtrackPath ??= null;
  e.isStray ??= false;
  e.strayUntil ??= 0;
  e.pendingOutcome ??= null;


  // normalize once (pixels/sec)
  if (typeof e.speedBase !== 'number') {
    const tile = state.GRID.tile;
    if (typeof e.pxPerSec === 'number')      e.speedBase = e.pxPerSec;
    else if (typeof e.speed === 'number')    e.speedBase = e.speed * tile; // tiles/sec → px/sec
    else                                     e.speedBase = 80;             // fallback
  }

  if (typeof e.dirX !== 'number' || typeof e.dirY !== 'number') {
    const d = e.dir || 'E';
    e.dirX = (d === 'E') ? 1 : (d === 'W') ? -1 : 0;
    e.dirY = (d === 'S') ? 0 + 1 : (d === 'N') ? -1 : 0; // 4-way
  }

  if (!Number.isInteger(e.tileX) || !Number.isInteger(e.tileY)) {
    if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
      e.tileX = e.cx; e.tileY = e.cy;
    }
  }
  if (typeof e.x !== 'number' || typeof e.y !== 'number') {
    const t = state.GRID.tile;
    const cx = Number.isInteger(e.tileX) ? e.tileX : (e.cx | 0);
    const cy = Number.isInteger(e.tileY) ? e.tileY : (e.cy | 0);
    e.x = (cx + 0.5) * t;
    e.y = (cy + 0.5) * t;
  }
}

// Bridge enemy objects from combat → FSM movement model (run once per enemy)
function ensureKinematics(e, gs) {
  if (e._kinOk) return;
  const t = gs.tileSize || state.GRID.tile || 32;

  if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
    e.tileX ??= e.cx;
    e.tileY ??= e.cy;
    if (typeof e.x !== 'number') e.x = (e.cx + 0.5) * t;
    if (typeof e.y !== 'number') e.y = (e.cy + 0.5) * t;
  }

  if (typeof e.dirX !== 'number' || typeof e.dirY !== 'number') {
    const map = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1] };
    const d = map[e.dir] || [1,0];
    e.dirX = d[0]; e.dirY = d[1];
  }

  if (typeof e.commitTilesLeft !== 'number') {
    e.commitTilesLeft = (e.commitSteps | 0) || 0;
  }

  if (typeof e.speedBase !== 'number') {
  if (typeof e.speed === 'number') {
    e.speedBase = e.speed;   // tiles/sec
  } else if (typeof e.pxPerSec === 'number') {
    // If any legacy code sets px/sec, convert once:
    e.speedBase = e.pxPerSec / (gs.tileSize || state.GRID.tile);
  } else {
    e.speedBase = 2.5; // sane tiles/sec fallback
  }
}

  // IMPORTANT: do NOT set e.speedBase here (it’s already px/sec from init).
  e._kinOk = true;
}



 // ——— Priority arbitration (global) ———
  // 1) Charge if dragon in sight
  // 2) Decision if at a junction and no commit left
  // 3) Fear if under effect
  // 4) Otherwise Search
  // But execution runs through current state's update to keep continuity.
    // Ensure we always have a valid state (guards against uninitialized enemies)
export function stepEnemyFSM(gs, e, dt) {
    ensureKinematics(e, gs);
  if (!hasState(e.state)) {
    initEnemyForFSM(e);           // sets e.state='search', e.stateT=0, speedMul, memory
  }

  const pri = CFG.PRI;

  // Compute “candidates”
  const candidates = [];
  if (e.fearT > 0) candidates.push('fear');
  import { isDecisionNode } from './perception.js'; // (top of file)
...
if (isDecisionNode(gs, e.tileX | 0, e.tileY | 0) && e.commitTilesLeft <= 0 && !(e.backtrackPath && e.backtrackPath.length)) {
  candidates.push('decision');
}
  if (/* lightweight check here; heavy LOS lives in search state update too */ false) candidates.push('charge');

  // Force Decision > Fear
  candidates.sort((a, b) => priOf(pri, b) - priOf(pri, a));
  const top = candidates[0] || e.state || 'search';


  // State transition if priority demands (except allow current state if same or higher)
  if (priOf(pri, top) > priOf(pri, e.state)) changeState(e, gs, top);

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
