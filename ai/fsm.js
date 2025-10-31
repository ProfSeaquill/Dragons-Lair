//ai/fsm.js
import { CFG } from './config.js';
import * as S_search from './states/search.js';
import * as S_decision from './states/decision.js';
import * as S_charge from './states/charge.js';
import * as S_fear from './states/fear.js';
import { initMemory } from './memory.js';
import * as state from '../state.js';
import * as S_attack from './states/attack.js';
import { isDecisionNode, canSeeDragon, canAttackDragon } from './perception.js';
import { ensureFreshTopology } from './topology.js';


// --- Safety helpers ---
const hasState = (s) => !!STATES[s];
const priOf = (pri, k) => (Number.isFinite(pri?.[k]) ? pri[k] : -Infinity);

const STATES = {
  search: S_search,
  decision: S_decision,
  charge: S_charge,
  attack: S_attack,
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


   // normalize once (tiles/sec)
  if (typeof e.speedBase !== 'number') {
    const tile = state.GRID.tile;
    if (typeof e.speed === 'number')        e.speedBase = e.speed;                 // tiles/sec
    else if (typeof e.pxPerSec === 'number') e.speedBase = e.pxPerSec / tile;      // px/sec -> tiles/sec
    else                                      e.speedBase = 2.5;                    // fallback tiles/sec
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

  // IMPORTANT: we keep e.speedBase in tiles/sec. Only compute it here if missing.
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

  // keep junction graph in sync with wall edits
  ensureFreshTopology(gs);
  
  // If the forward link is no longer traversable, drop the commit now
{
  const topo = gs.topology;
  if (topo && Number.isInteger(e.tileX) && Number.isInteger(e.tileY) && (e.commitTilesLeft|0) > 0) {
    const cell = topo.grid?.[e.tileY]?.[e.tileX];
    if (cell) {
      const dx = e.dirX | 0, dy = e.dirY | 0;
      const canGo =
        (dx ===  1 && cell.E) ||
        (dx === -1 && cell.W) ||
        (dy ===  1 && cell.S) ||
        (dy === -1 && cell.N);
      if (!canGo) {
        e.commitTilesLeft = 0; // trigger decision next
        // trace once per offender:
        if (!e._loggedBlocked) {
          console.debug('[fsm] forward blocked; dropping commit for', e.id ?? '(no-id)', { x:e.tileX, y:e.tileY, dx, dy });
          e._loggedBlocked = true;
        }
      }
    }
  }
}

    // --- apply slow to the effective speed ---
  // Keep e.speedBase as tiles/sec canonical; derive e.speed every frame.
// fsm.js — inside stepEnemyFSM, right after ensureKinematics(...)
{
  const hasSlow = (e.slowLeft > 0) && Number.isFinite(e.slowMult);
  const slowMul = hasSlow ? Math.max(0, Math.min(1, e.slowMult)) : 1;
  const otherMul = (typeof e.speedMul === 'number' && e.speedMul > 0) ? e.speedMul : 1;

  // effective tiles/sec for this frame
  const baseTilesPerSec = (typeof e.speedBase === 'number') ? e.speedBase : 2.5;
  const effTilesPerSec  = baseTilesPerSec * slowMul * otherMul;
  e.speed = effTilesPerSec;

  // also provide a px/sec for any states using pixel integrators
  const tsize = gs.tileSize || state.GRID.tile || 32;
  e.pxPerSec = effTilesPerSec * tsize;

  // --- hard stun: freeze & decrement locally, then bail this frame ---
  if ((e.stunLeft || 0) > 0) {
    e.vx = 0; e.vy = 0;
    e.pausedForAttack = true;

    // ↓ ensure stun actually counts down even when we skip state logic
    e.stunLeft = Math.max(0, (e.stunLeft || 0) - dt);

    // optional: also tick slow timers here so durations feel consistent
    if (e.slowLeft > 0) e.slowLeft = Math.max(0, e.slowLeft - dt);

    return; // do not run state logic while stunned
  }

  // if slow expired, clean up multiplier
  if (e.slowLeft <= 0 && typeof e.slowMult === 'number') {
    e.slowMult = 1;
  }
}


  if (!hasState(e.state)) {
    initEnemyForFSM(e);           // sets e.state='search', e.stateT=0, speedMul, memory
  }

  const pri = CFG.PRI;

  // Compute “candidates”
  const candidates = [];
  if (e.fearT > 0) candidates.push('fear');
if (isDecisionNode(gs, e.tileX | 0, e.tileY | 0) && e.commitTilesLeft <= 0 && !(e.backtrackPath && e.backtrackPath.length)) {
  candidates.push('decision');
}
 
  if (canAttackDragon(gs, e)) candidates.push('attack');
// Only consider Charge if we have LOS AND we're not already in melee range.
if (canSeeDragon(gs, e.tileX|0, e.tileY|0) && !canAttackDragon(gs, e)) {
  candidates.push('charge');
}
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

// ---- SAFETY: if Decision didn’t resolve, pick a sane exit and go ----
if (e.state === 'decision' && (!next || next === 'decision')) {
  const noCommit = (e.commitTilesLeft|0) <= 0;
  const noPlan   = !e.path || e.path.length === 0;
  if (noCommit && noPlan && Number.isInteger(e.tileX) && Number.isInteger(e.tileY)) {
    const cell = gs.topology?.grid?.[e.tileY]?.[e.tileX];
    if (cell) {
      // Prefer stepping toward EXIT if that side is open; else first open side.
      const dx = Math.sign((state.EXIT.x|0) - (e.tileX|0));
      const dy = Math.sign((state.EXIT.y|0) - (e.tileY|0));
      const pref = [];
      if (dx > 0 && cell.E) pref.push('E');
      if (dx < 0 && cell.W) pref.push('W');
      if (dy > 0 && cell.S) pref.push('S');
      if (dy < 0 && cell.N) pref.push('N');
      // fill with any open sides to guarantee progress
      if (cell.E) pref.push('E');
      if (cell.W) pref.push('W');
      if (cell.S) pref.push('S');
      if (cell.N) pref.push('N');

      const side = pref[0]; // first viable
      if (side) {
        e.dir = side;
        e.dirX = (side==='E')? 1 : (side==='W')? -1 : 0;
        e.dirY = (side==='S')? 1 : (side==='N')? -1 : 0;

        // take at least 1 committed tile so we actually leave the node
        e.commitDir = side;
        e.commitSteps = Math.max(1, e.commitSteps|0);
        e.commitTilesLeft = Math.max(1, e.commitTilesLeft|0);

        // optionally reinforce “success” so herding has something to learn from
        try { (typeof bumpSuccess === 'function') && bumpSuccess(gs, e.tileX, e.tileY, 0.25); } catch {}
        changeState(e, gs, 'search'); // resume normal locomotion
      }
    }
  }
}

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
