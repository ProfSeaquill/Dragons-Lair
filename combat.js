// combat.js (top)
import * as state from './state.js';
// New pathing wrappers (added in state.js patch)
import { pathSpawnAgent, pathUpdateAgent, pathRenderOffset, GRID, ENTRY, EXIT, ensureFreshPathing, pathDespawnAgent } from './state.js';
import { isInAttackZone } from './grid/attackzone.js';
import { updateAttacks } from './pathing/attack.js';
import { spawnClawSlashEffect } from './combat/upgrades/abilities/claw.js';
import { spawnWingGustCorridorFX } from './combat/upgrades/abilities/wing_gust.js';
import { applyRoar } from './combat/upgrades/abilities/roar.js';
import { applyStomp } from './combat/upgrades/abilities/stomp.js';



// === Ability cooldown timers (module-local) ===
// Initialized to 0; abilities will set cooldowns from cfg on use (ps.cd),
// and you may also reset them at wave start if desired.
let gustCooldown  = 0;
let roarCooldown  = 0;
let stompCooldown = 0;
let clawCooldown  = 0;

// Unique enemy IDs (module-local counter)
let __ENEMY_ID = 0;

let effectsLoopLoggedOnce = false;


// ===== Phase 9: object pools (prevent GC churn) =====
const ENEMY_POOL = new Map();   // type -> array of recycled enemies
const EFFECT_POOL = new Map();  // kind -> array of recycled effects

// Resolve '__mixed__' into a concrete type using tuning.waves.mixCurves.
function __resolveMixedType(gs, t) {
  if (t !== '__mixed__') return t;

  const cfg    = (window.state && window.state.getCfg) ? window.state.getCfg(gs) : (gs.cfg || null);
  const curves = cfg?.tuning?.waves?.mixCurves;
  if (!curves) return 'villager';

  const wave = (gs.wave | 0) || 1;
  const weights = [];

  for (const [k, v] of Object.entries(curves)) {
    const min = (v.minWave|0) || 1;
    if (wave < min) continue;

    const base = +v.base || 0;
    const cap  = +v.cap  || 0;
    const K    = (typeof v.k === 'number') ? v.k : 0.5; // same shape you logged
    const w    = cap + (base - cap) * Math.exp(-K * Math.max(0, wave - min));
    if (w > 0) weights.push([k, w]);
  }

  if (!weights.length) return 'villager';
  let sum = 0; for (const [,w] of weights) sum += w;
  let r = Math.random() * sum;
  for (const [k,w] of weights) { r -= w; if (r <= 0) return k; }
  return weights[0][0];
}

function acquireEnemy(type, wave, initFn) {
  const pool = ENEMY_POOL.get(type);
  let e = (pool && pool.length) ? pool.pop() : makeEnemy(type, wave);
  // RESET mutable fields fast (avoid per-spawn object literals)
  e.id = 0; e.groupId = 0; e.followLeaderId = null; e.leader = false; e.torchBearer = false;
  e.burnLeft = 0; e.burnDps = 0; e.stunLeft = 0; e.slowLeft = 0; e.roarBuffLeft = 0;
  e.pausedForAttack = false; e.isAttacking = false;
  e.hp = e.maxHp; e.lastHitAt = 0; e.showHpUntil = 0; e.slowMult = 1;

    // --- reset positional / steering state (important for pooled enemies) ---
  e.x = undefined;
  e.y = undefined;

  // 💥 kill any stale render-smoothing carried by the pool
    // Leave undefined so spawners MUST seed these; renderer should not assume defaults
  e.drawX = e.drawY = e.prevX = e.prevY = undefined;

  e.ox = 0;
  e.oy = 0;
  e.tBorn = 0;        // set on spawn

    e.sepX = 0; e.sepY = 0;
  e.sepOffsetX = 0; e.sepOffsetY = 0;
  e._suppressSep = false;


e.cx = 0;
e.cy = 0;
e.tileX = undefined;
e.tileY = undefined;
e.prevCX = undefined;
e.prevCY = undefined;
e.vx = 0;
e.vy = 0;
e.dir = 'E';
e.kb = null; // ← clear any leftover knockback state from the pool
// --- engineer / tunneling state (must be hard-reset when pulled from the pool)
e._tunnelArmed   = false;   // ← crucial: pooled engineers must re-arm
e.surfaceGraceT  = 0;       // will be set at spawn for engineers
e.tunnelT        = 0;       // will be set at spawn for engineers
e.tunneling = false;
e.updateByCombat = false;
e._tunnelStartPx = null;
e._tunnelDestPx  = null;
e._tunnelDestCell = null;
e._tunnelTotal = 0;
e._tunnelElapsed = 0;
e.commitDir = null;
e.commitSteps = 0;
e.commitTilesLeft = 0;
e.isAttacking = false;
e.pausedForAttack = false;
e.speedMul = 1;
// wipe any nav/lerp scratch that a pooled enemy could carry over
e.fromXY = null;        // some pathers keep a [x,y] start of segment
delete e._fromX; delete e._fromY;
delete e._seg; delete e._acc; delete e._lerp; delete e._t;
// Also wipe the FSM smoother’s pixel fields so updateAgent will re-seed them
delete e._fromPX; delete e._fromPY;
delete e._toPX;   delete e._toPY;
delete e._stepAcc;

  if (initFn) initFn(e);
  return e;
}

function releaseEnemy(e) {
  if (!e || !e.type) return;
  // 🧹 kill any navigator state tied to this object reference
  try { pathDespawnAgent?.(e); } catch (_) {}

  // (optional, but nice) remove per-enemy visuals bookkeeping if you keep Maps in main.js
  try {
    globalThis.TorchLights?.delete?.(e.id);
    globalThis.__firstSeen?.delete?.(e.id);
  } catch (_) {}
  let pool = ENEMY_POOL.get(e.type);
  if (!pool) { pool = []; ENEMY_POOL.set(e.type, pool); }
  pool.push(e);
}

// --- Nav presets + merge (combat.js) -----------------------------------------
const NAV_PRESETS = {
  hunter:   { pathHeur: 'astar',     epsilonWorse: 0.10, bias: { bandGain: 1.6, keepHeading: 0.08, deltaH: 0.00, eastNudge: 0.00 } },
  beeLine:  { pathHeur: 'astar',     epsilonWorse: 0.00, bias: { bandGain: 0.0, keepHeading: 0.05, deltaH: 0.00, eastNudge: 0.00 } },
  wanderer: { pathHeur: 'manhattan', epsilonWorse: 0.40, bias: { bandGain: 0.9, keepHeading: 0.05, deltaH: 0.00, eastNudge: 0.00 } },
  cautious: { pathHeur: 'manhattan', epsilonWorse: 0.20, bias: { bandGain: 1.2, keepHeading: 0.12, deltaH: 0.02, eastNudge: 0.00 } },
};

function __mergeBias(a={}, b={}) {
  return {
    bandGain:   (b.bandGain   ?? a.bandGain   ?? 1.0),
    keepHeading:(b.keepHeading?? a.keepHeading?? 0.10),
    deltaH:     (b.deltaH     ?? a.deltaH     ?? 0.00),
    eastNudge:  (b.eastNudge  ?? a.eastNudge  ?? 0.00),
  };
}

function buildEnemyNav(type, gs) {
  const base = (state.enemyBase?.(type, gs)) || {};
  const presetName = base.navPreset && String(base.navPreset);
  const preset = (presetName && NAV_PRESETS[presetName]) || {};
  const ov = base.nav || {};
  return {
    pathHeur:     ov.pathHeur     ?? preset.pathHeur     ?? 'manhattan',
    epsilonWorse: (typeof ov.epsilonWorse === 'number') ? ov.epsilonWorse
                   : (typeof preset.epsilonWorse === 'number') ? preset.epsilonWorse
                   : 0.30,
    bias: __mergeBias(preset.bias, ov.bias),
  };
}



function acquireEffect(kind, seedObj) {
  const pool = EFFECT_POOL.get(kind);
  let fx = (pool && pool.length) ? pool.pop() : {};
  // reset in-place (no new objects)
  fx.type = kind; fx.dead = false; fx.t = 0; fx.dur = 0;
  fx.x = 0; fx.y = 0;
  fx.path = null; fx.headIdx = 0; fx.tilesPerSec = 0; fx.widthPx = 0;
  fx.timer = 0; fx.dmg = 0;
  if (seedObj) Object.assign(fx, seedObj);
  return fx;
}
function releaseEffect(fx) {
  if (!fx || !fx.type) return;
  let pool = EFFECT_POOL.get(fx.type);
  if (!pool) { pool = []; EFFECT_POOL.set(fx.type, pool); }
  // drop large references
  fx.path = null;
  pool.push(fx);
}

// Seed "success trail" at a tile — replaces old pathing.bumpSuccess dynamic import
function bumpSuccess(gs, x, y, amt = 1) {
  const T = gs.successTrail;
  if (!T) return;
  if (!state.inBounds(x, y)) return;
  const v = (T[y][x] || 0) + amt;
  T[y][x] = v;
}

// Ensure success-trail field exists and is zeroed for the current grid
function ensureSuccessTrail(gs) {
  const W = state.GRID.cols, H = state.GRID.rows;
  if (!gs.successTrail ||
      gs.successTrail.length !== H ||
      gs.successTrail[0]?.length !== W) {
    gs.successTrail = state.makeScalarField(W, H, 0);
  } else {
    // zero existing field (cheaper than realloc)
    for (let y = 0; y < H; y++) {
      const row = gs.successTrail[y];
      for (let x = 0; x < W; x++) row[x] = 0;
    }
  }
}

// --- Wave-end hard wipe (actors + per-wave scratch) -------------------------
function hardWipeActors(gs) {
  // 1) Enemies → release to pool, then empty array
  if (Array.isArray(gs.enemies)) {
    for (let i = gs.enemies.length - 1; i >= 0; i--) {
      const e = gs.enemies[i];
      if (e) releaseEnemy(e);
    }
    gs.enemies.length = 0;
  } else {
    gs.enemies = [];
  }

  // 2) Nuke transient effects (visuals, tunnels, bombs, splashes, etc.)
  if (Array.isArray(gs.effects)) {
    gs.effects.length = 0;
  } else {
    gs.effects = [];
  }

  // 3) Pathing/nav registry cleanup if your state exposes it
  try {
    if (typeof state.pathReset === 'function')       state.pathReset(gs);
    else if (typeof state.pathForgetAll === 'function') state.pathForgetAll(gs);
  } catch (_) { /* optional */ }

  // 4) Per-wave systems reset
  ensureSuccessTrail(gs);        // fresh herding/scent map
  gs._straysActive = 0;          // curiosity limiter
  gs.__firstTorchGiven = false;  // force re-pick next wave
  gs.__torchWaveId = (gs.__torchWaveId | 0) + 1; // de-sync any stale light ties

  // 5) Let main.js clear its light pools / firstSeen cache
  try { window.dispatchEvent?.(new CustomEvent('dl-wave-hardened-wipe')); } catch(_) {}
}

// expose cooldowns for UI
export function getCooldowns() {
  return {
    gust:  Math.max(0, gustCooldown  || 0),
    roar:  Math.max(0, roarCooldown  || 0),
    stomp: Math.max(0, stompCooldown || 0),
    claw:  Math.max(0, clawCooldown  || 0),
  };
}



function dragonPerimeterTiles(gs) {
  const set = new Set();
  const out = [];
  // Only WEST offsets
  for (const c of state.dragonCells(gs)) {
    const nx = c.x - 1, ny = c.y;
    if (!state.inBounds(nx, ny)) continue;
    if (state.isDragonCell(nx, ny, gs)) continue; // skip interior
    const k = state.tileKey(nx, ny);
    if (!set.has(k)) { set.add(k); out.push({ x: nx, y: ny }); }
  }
  return out;
}


// Push one step along grid if the edge is open (no walls). Returns new (x,y).
function stepIfOpen(gs, x, y, dir) {
  const side = (dir === 'E') ? 'E' : (dir === 'W') ? 'W' : (dir === 'S') ? 'S' : 'N';
  if (!state.isOpen(gs, x, y, side)) return { x, y }; // blocked by wall/out of bounds
  switch (side) {
    case 'E': return { x: x + 1, y };
    case 'W': return { x: x - 1, y };
    case 'S': return { x, y: y + 1 };
    case 'N': return { x, y: y - 1 };
  }
  return { x, y };
}

// Animate precomputed knockback path tile-by-tile.
// e.kb = { path:[{x,y},...], seg:0, acc:0, durPerTile:0.08, tsize }
function tickKnockback(e, dt) {
  const kb = e.kb;
  if (!kb || !kb.path || kb.path.length < 2) { e.kb = null; return; }

  kb.acc += dt;

  // commit whole-tile steps that elapsed
  while (kb.acc >= kb.durPerTile && kb.seg < kb.path.length - 1) {
    kb.acc -= kb.durPerTile;
    kb.seg++;
    const node = kb.path[kb.seg];
    e.cx = node.x;
    e.cy = node.y;
    e.tileX = node.x;
    e.tileY = node.y;
  }

  const t = kb.tsize || (state.GRID.tile || 32);

  // finished?
  if (kb.seg >= kb.path.length - 1) {
    const last = kb.path[kb.path.length - 1];

    // snap to last tile center
    e.x = (last.x + 0.5) * t;
    e.y = (last.y + 0.5) * t;
    e.drawX = e.x;
    e.drawY = e.y;

    // face generally toward EXIT so FSM resumes sensibly
    const dx = state.EXIT.x - last.x;
    const dy = state.EXIT.y - last.y;
    e.dir = Math.abs(dx) >= Math.abs(dy)
      ? (dx >= 0 ? 'E' : 'W')
      : (dy >= 0 ? 'S' : 'N');
    e.commitDir = null;
    e.commitSteps = 0;
    e.commitTilesLeft = 0;
    e.isAttacking = false;
    e.pausedForAttack = false;

    // Clear knockback and re-seed the navigator at this new tile
    e.kb = null;
    try {
      pathSpawnAgent?.(e); // restart FSM from e.cx/e.cy
    } catch (_) {}
    return;
  }

  // mid-flight: interpolate within current segment and drive drawX/drawY
  const a = kb.path[kb.seg];
  const b = kb.path[kb.seg + 1];
  const u = Math.max(0, Math.min(1, kb.acc / kb.durPerTile));

  const ax = (a.x + 0.5) * t, ay = (a.y + 0.5) * t;
  const bx = (b.x + 0.5) * t, by = (b.y + 0.5) * t;

  const px = ax + (bx - ax) * u;
  const py = ay + (by - ay) * u;

  e.x = px;
  e.y = py;
  e.drawX = px;
  e.drawY = py;

  // keep facing coherent with motion
  e.dir = (bx > ax) ? 'E'
       : (bx < ax) ? 'W'
       : (by > ay) ? 'S'
       : 'N';
}

export function wingGustPush(gs, tiles) {
  const t = state.GRID.tile || 32;

  // Dragon anchor (centroid of dragon footprint)
  const cells = state.dragonCells(gs);
  if (!cells || !cells.length) return;

  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const ax = Math.round(sx / Math.max(1, cells.length));
  const ay = Math.round(sy / Math.max(1, cells.length));

  // ---- Enemies ----
  for (const e of gs.enemies || []) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    if (e.type === 'engineer' && e.tunneling) continue; // don’t shove burrowers

    const dx0 = e.cx - ax, dy0 = e.cy - ay;
    const distMan = Math.abs(dx0) + Math.abs(dy0);
    if (distMan <= 0) continue;                 // sitting inside dragon; ignore
    if (distMan > tiles) continue;              // out of gust radius

    const pushSteps = Math.max(0, tiles - distMan);
    if (pushSteps === 0) continue;

    // Pick outward direction along dominant axis (away from anchor)
    let dir;
    if (Math.abs(dx0) >= Math.abs(dy0)) dir = (dx0 >= 0) ? 'E' : 'W';
    else                                dir = (dy0 >= 0) ? 'S' : 'N';

    // Walk step-by-step, respecting walls and not shoving into dragon
    let nx = e.cx, ny = e.cy;
    for (let k = 0; k < pushSteps; k++) {
      const step = stepIfOpen(gs, nx, ny, dir);
      if (step.x === nx && step.y === ny) break;            // blocked
      if (state.isDragonCell(step.x, step.y, gs)) break;    // don't push into dragon
      nx = step.x; ny = step.y;
    }

    if (nx === e.cx && ny === e.cy) continue;

    // Build the per-tile path we just traced
    const path = [{ x: e.cx, y: e.cy }];
    {
      const dx0b = e.cx - ax, dy0b = e.cy - ay;
      const dir2 = (Math.abs(dx0b) >= Math.abs(dy0b))
        ? (dx0b >= 0 ? 'E' : 'W')
        : (dy0b >= 0 ? 'S' : 'N');
      let px = e.cx, py = e.cy;
      const steps = Math.max(1, Math.abs(nx - e.cx) + Math.abs(ny - e.cy));
      for (let k = 0; k < steps; k++) {
        const step = stepIfOpen(gs, px, py, dir2);
        if (step.x === px && step.y === py) break;
        if (state.isDragonCell(step.x, step.y, gs)) break;
        px = step.x; py = step.y;
        path.push({ x: px, y: py });
        if (px === nx && py === ny) break;
      }
    }

    if (path.length >= 2) {
      e.kb = {
        path,
        seg: 0,
        acc: 0,
        durPerTile: 0.08,            // tune: 0.06 snappier, 0.12 chunkier
        tsize: state.GRID.tile || 32
      };
      e.isAttacking     = false;
      e.pausedForAttack = false;
      e.commitDir       = null;
      e.commitSteps     = 0;
      e.commitTilesLeft = 0;

      // tiny tick just to show HP bar flash
      markHit(e, 0.0001);
    }
  }

  // ---- Bombs (optional, same falloff & walls) ----
  for (const fx of (gs.effects || [])) {
    if (fx.type !== 'bomb') continue;
    let cx = Math.floor(fx.x / t);
    let cy = Math.floor(fx.y / t);

    const dx0 = cx - ax, dy0 = cy - ay;
    const distMan = Math.abs(dx0) + Math.abs(dy0);
    if (distMan <= 0 || distMan > tiles) continue;

    const pushSteps = Math.max(0, tiles - distMan);
    let dir;
    if (Math.abs(dx0) >= Math.abs(dy0)) dir = (dx0 >= 0) ? 'E' : 'W';
    else                                dir = (dy0 >= 0) ? 'S' : 'N';

    for (let k = 0; k < pushSteps; k++) {
      const step = stepIfOpen(gs, cx, cy, dir);
      if (step.x === cx && step.y === cy) break;
      cx = step.x; cy = step.y;
    }

    fx.x = (cx + 0.5) * t;
    fx.y = (cy + 0.5) * t;
  }
}



// --- Spawn helper: give freshly-spawned enemies a "previous cell" (if available)
// and a short forward commit so they don't immediately reconsider direction.
//
// e: enemy object (must already have e.cx, e.cy, e.dir set)
function initializeSpawnPrevAndCommit(e) {
  // Derive a backward offset from the facing direction (dir points where they are heading)
  const dx = (e.dir === 'E' ? 1 : e.dir === 'W' ? -1 : 0);
  const dy = (e.dir === 'S' ? 1 : e.dir === 'N' ? -1 : 0);

  // prev cell is one step behind current position
  const prevX = e.cx - dx;
  const prevY = e.cy - dy;

  if (Number.isInteger(prevX) && Number.isInteger(prevY) && state.inBounds(prevX, prevY)) {
    e.prevCX = prevX;
    e.prevCY = prevY;
  }

  // Give a short commitment so the first few steps are forced straight.
  // This prevents immediate decision logic at the spawn tile (esp. at edges).
  e.commitDir = e.dir;
  // 2 steps is a conservative default; increase to 3 if you want stronger initial straight bias.
  e.commitSteps = Math.max(e.commitSteps || 0, 2);
  e.commitTilesLeft = Math.max(e.commitTilesLeft || 0, e.commitSteps);

}


/* =========================
 * Enemy templates & scaling
 * ========================= */
// k controls “tempo” (higher = faster early growth). Always reaches cap at p=1.
const ENEMY_MAX_WAVE = 51;
function waveP(w, max = ENEMY_MAX_WAVE) { return Math.min(1, Math.max(0, (Math.max(1, w|0)-1) / (max-1))); }
function exp01(p, k=3){ 
  const d=1-Math.exp(-k); 
  return d>0 ? (1-Math.exp(-k*p))/d : p; }
function lerpCap(base, cap, p, {shape='exp', k=3, a=1}={}) {
  const t = Math.max(0, Math.min(1, p));
  const s = shape==='lin' ? t : shape==='pow' ? Math.pow(t, Math.max(1e-4,a)) : exp01(t, k);
  return base + (cap - base) * s;
}


const FLAGS = {
  bossEvery: 5,             // Knight of the Round Table cadence
  kingsguardEvery: 1,       // truthy → enable "one wave before each boss"
  engineerBombTimer: 5,
  engineerTravelTime: 4.0,
  engineerBombDmg: 25,
  spawnGap: 0.45,
  groupGap: 2.0,
  groupMin: 4,
  groupMax: 10,
};


// -------- Wave helpers --------
// Progress gated by unlock (minWave): 0 before unlock; 1 at maxWave
function unlockedProgress(wave, minWave = 1, maxWave = ENEMY_MAX_WAVE) {
  if (wave < (minWave | 0)) return 0;
  const span = Math.max(1, (maxWave - (minWave | 0)));
  const p = (wave - (minWave | 0)) / span;
  return Math.max(0, Math.min(1, p));
}

// Optional power shape (a>0)
function pow01(p, a = 1.0) {
  const t = Math.max(0, Math.min(1, p));
  return Math.pow(t, Math.max(0.0001, a));
}

// Linear shape
function lin01(p) { return Math.max(0, Math.min(1, p)); }

function TW(gs = state.GameState) {
  const cfg = state.getCfg?.(gs) || {};
  const tW  = cfg.tuning && cfg.tuning.waves;

  // Only accept a *proper object* for tuning.waves (must not be an array)
  if (tW && typeof tW === 'object' && !Array.isArray(tW)) return tW;
  
  return null; // require tuning.waves explicitly
}


const _val = (v, d) => (v == null ? d : v);

function tunedSpawnParams(gs = state.GameState) {
  const g = TW(gs)?.groups;
  return {
    min:      _val(g?.min,      FLAGS.groupMin),
    max:      _val(g?.max,      FLAGS.groupMax),
    spawnGap: _val(g?.spawnGap, FLAGS.spawnGap),
    groupGap: _val(g?.groupGap, FLAGS.groupGap),
  };
}

function waveCountFor(wave, gs = state.GameState) {
  const c = TW(gs)?.count;
  if (!c) return 0; // no config → no units
 return Math.max(0, Math.round(approachCap(c.base, c.cap, wave, c.k)));
}


// choose a core mix for the wave from tuning.mix (deterministic)
function selectWeightsForWave(wave, gs = state.GameState) {
  const mix = TW(gs)?.mix;
  if (Array.isArray(mix) && mix.length) {
    // first rule whose [from,until] contains wave
    for (const rule of mix) {
      const from  = (rule.fromWave ?? -Infinity);
      const until = (rule.untilWave ??  Infinity);
      if (wave >= from && wave <= until && rule.weights) return rule.weights;
    }
  }
  // fallback to old hardcoded tiers
  if (wave < 4)  return { villager: 1 };
  if (wave < 8)  return { villager: 2, squire: 1 };
  return { squire: 1, knight: 1 };
}

// expand N core units using fractional rounding (no RNG => preview == live counts)
function expandByWeights(weights, count) {
  const keys = Object.keys(weights).filter(k => (weights[k] ?? 0) > 0);
  if (!keys.length || count <= 0) return [];
  const sum = keys.reduce((s, k) => s + Math.max(0, Number(weights[k]) || 0), 0) || 1;

  const rows = keys.map(k => {
    const ideal = (count * (weights[k] / sum));
    const n = Math.floor(ideal);
    return { k, n, frac: ideal - n };
  });

  let used = rows.reduce((s, r) => s + r.n, 0);
  let rem = count - used;

  // give remaining units to largest fractional parts (stable)
  rows.sort((a, b) => (b.frac - a.frac) || (a.k < b.k ? -1 : 1));
  for (let i = 0; i < rem; i++) rows[i % rows.length].n++;

  // build list in a fixed key order for readability
  rows.sort((a, b) => a.k.localeCompare(b.k));
  const out = [];
  for (const r of rows) for (let i = 0; i < r.n; i++) out.push(r.k);
  return out;
}


// Smooth asymptotic growth: starts near `base`, rises quickly early,
// then slows and approaches `cap` as wave → ∞.
// k is the “tempo” (higher k = reaches the cap faster).
function approachCap(base, cap, wave, k) {
  const w = Math.max(0, (wave | 0) - 1);
  return cap - (cap - base) * Math.exp(-k * w);
}

function makeEnemy(type, wave) {
  const base = state.enemyBase(type) || {};           // ← from enemies.json
  const es   = state.getCfg(state.GameState)?.tuning?.enemyScaling || {};

  const p    = waveP(wave, es.maxWave ?? 101);

  // Bases (with safe fallbacks)
  const hp0   = Number(base.hp)    || 10;
  const spd0  = Number(base.speed ?? base.speedTilesPerSec ?? base.moveSpeed) || 1.0; // tiles/sec

  const rate0 = Number(base.rate)  || 0.5;           // attacks/sec
  const dps0  = (Number(base.damage)||1) * rate0;    // treat damage scaling in DPS

  // Caps
  const hpCap  = hp0  * (es.hpCapMult  ?? 10.0);
  const spdCap = spd0 * (es.spdCapMult ?? 1.5);
  const dpsCap = dps0 * (es.dpsCapMult ?? 1.0);

  // Shapes
  const shape = es.shape || 'exp';
  const hp  = Math.round( lerpCap(hp0,  hpCap,  p, {shape, k: es.kHP  ?? 3.0}) );
  const spd =              lerpCap(spd0, spdCap, p, {shape, k: es.kSPD ?? 1.0});
  const dps =              lerpCap(dps0, dpsCap, p, {shape, k: es.kDPS ?? 2.6});

  // Convert DPS back to per-hit, keeping the *base* enemy cadence unless you want that to scale too
  const rate = rate0; // keep attacks/sec from enemies.json
  const dmgPerHit = Math.max(1, Math.round(dps / Math.max(0.01, rate)));

  const out = {
    type, name: type,
    hp, maxHp: hp,
    speed: spd, speedBase: spd, speedMul: 1,
    damage: dmgPerHit,
    rate,
    range: Number(base.range) || 1,
    // ...rest of your fields...
  };

  // Optional: apply cosmetic/flag overrides from enemies.json (gold, bones, armor, shielded, tags, sprite, etc.)
  if (typeof base.gold === 'number')  out.gold  = base.gold|0;
  if (typeof base.bones === 'number') out.bones = base.bones|0;
  if (typeof base.armor === 'number') out.armor = base.armor|0;
  if (typeof base.shielded === 'boolean') out.shield = !!base.shielded;
  if (Array.isArray(base.tags)) {
  out.tags = [...base.tags];

  // Derive convenience flags from tags
  if (base.tags.includes('miniboss')) {
    out.miniboss = true;
  }
  if (base.tags.includes('boss')) {
    out.boss = true;  // handy if you ever want special boss visuals
  }
}


  
 // (keep your special-name switch and engineer tunneling bits as you have now)
  return out;
}

/* =========================
 * Spawning
 * ========================= */

function spawnOne(gs, type) {
  console.debug('[spawn base]', type, state.enemyBase?.(type, gs));
  const e = acquireEnemy(type, gs.wave | 0);
e.id = (++__ENEMY_ID);
e.nav = buildEnemyNav(type, gs); // <- attach per-enemy nav from config

if (type === 'engineer') {
  e.surfaceGraceT = 0.6;                 // seconds above ground before burrowing
e.tunnelT = FLAGS.engineerTravelTime;  // travel time once underground
}

  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';

 // tile/pixel assignment
  {
  const t = state.GRID.tile || 32;
e.x = (e.cx + 0.5) * t;
e.y = (e.cy + 0.5) * t;
e.tileX = e.cx | 0;
e.tileY = e.cy | 0;
}

    // --- SPAWN RENDER RESET (prevents “zoom from death spot”) ---
  e.drawX = e.x;
  e.drawY = e.y;
  e.prevX = e.x;
  e.prevY = e.y;

  console.debug('[spawn reset]', e.id, {
  x: e.x, y: e.y,
  drawX: e.drawX, drawY: e.drawY,
  prevX: e.prevX, prevY: e.prevY,
  ox: e.ox, oy: e.oy,
  sepX: e.sepX, sepY: e.sepY,
  sup: e._suppressSep
});


  // Clear any sub-tile visual offsets / separation residue
  e.ox = 0; e.oy = 0;
  e.sepX = 0; e.sepY = 0;         // if your separation uses these
  e.sepOffsetX = 0; e.sepOffsetY = 0; // if using alt names in separation module
  e._suppressSep = false;         // allow separation unless the zone locks it

  // Fresh spawn timestamp so update() can clamp pathRenderOffset for ~120ms
  e._spawnAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();


  // seed a stable 'from' for the very first render lerp
e.fromXY = [e.cx, e.cy];
  
  // speed in pixels/sec (navigator reads this)
{
  const tsize = state.GRID.tile || 32;
  // tiles/sec (from makeEnemy scaling) → px/sec
  e.pxPerSec = (typeof e.speed === 'number') ? e.speed * tsize : 80;
  e.speedBase = e.speed;
  e.speedTilesPerSec = (typeof e.speed === 'number') ? e.speed : (e.pxPerSec / tsize);

  // heading unit vector consistent with e.dir
  const dirMap = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1] };
  const v = dirMap[e.dir] || [1,0];
  e.dirX = v[0];
  e.dirY = v[1];
}


  // initialize prev/commit so freshly-spawned enemies head straight initially
  initializeSpawnPrevAndCommit(e);
  try { pathDespawnAgent?.(e); } catch (_) {} // if object was pooled, erase any stale agent
  
  // Register with new pathing
  pathSpawnAgent(e, gs);
  // seed navigator once so its internal chain is fresh
try { pathUpdateAgent(e, 0, gs); } catch (_) {}


  gs.enemies.push(e);

if (typeof e.trailStrength === 'number') {
  bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
}
}

function spawnOneIntoGroup(gs, type, groupId, currentLeaderId) {
  console.debug('[spawn base]', type, state.enemyBase?.(type, gs));
  const e = acquireEnemy(type, gs.wave | 0);
  e.id = (++__ENEMY_ID);
  e.nav = buildEnemyNav(type, gs);
  
if (type === 'engineer') {
 e.surfaceGraceT = 0.6;                 // seconds above ground before burrowing
 e.tunnelT = FLAGS.engineerTravelTime;  // travel time once underground
}

  e.groupId = groupId | 0;
  e.routeSeed = e.routeSeed ?? ((Math.random() * 1e9) | 0);
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';

  {
  const t = state.GRID.tile || 32;
e.x = (e.cx + 0.5) * t;
e.y = (e.cy + 0.5) * t;
e.tileX = e.cx | 0;
e.tileY = e.cy | 0;
}

    // --- SPAWN RENDER RESET ---
  e.drawX = e.x;
  e.drawY = e.y;
  e.prevX = e.x;
  e.prevY = e.y;

   console.debug('[spawn reset]', e.id, {
  x: e.x, y: e.y,
  drawX: e.drawX, drawY: e.drawY,
  prevX: e.prevX, prevY: e.prevY,
  ox: e.ox, oy: e.oy,
  sepX: e.sepX, sepY: e.sepY,
  sup: e._suppressSep
});

  e.ox = 0; e.oy = 0;
  e.sepX = 0; e.sepY = 0;
  e.sepOffsetX = 0; e.sepOffsetY = 0;
  e._suppressSep = false;

 // mark spawn time so we can suppress offsets for a heartbeat
e._spawnAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  // seed a stable 'from' for the very first render lerp
e.fromXY = [e.cx, e.cy];


  {
  const tsize = state.GRID.tile || 32;
  e.pxPerSec = (typeof e.speed === 'number') ? e.speed * tsize : 80;
  e.speedBase = e.speed;
  e.speedTilesPerSec = (typeof e.speed === 'number') ? e.speed : (e.pxPerSec / tsize);

  const dirMap = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1] };
  const v = dirMap[e.dir] || [1,0];
  e.dirX = v[0];
  e.dirY = v[1];
}

    // Each member follows the current group leader (set after the first spawn)
  e.followLeaderId = currentLeaderId ?? null;
  e.independentNav = false;

  // Independent types (scouts / bosses / minibosses, etc.) roam on their own
  // and do NOT participate in group-follow behavior.
  try {
    const { independentSet } = getGroupPolicy(gs, FLAGS);
    if (independentSet && independentSet.has(e.type)) {
      e.followLeaderId = null;
      e.independentNav = true;
    }
  } catch (_) {
    // safe if helper not yet loaded
  }

  
  initializeSpawnPrevAndCommit(e);
  try { pathDespawnAgent?.(e); } catch (_) {} // if object was pooled, erase any stale agent
  pathSpawnAgent(e, gs);
  // seed navigator once so its internal chain is fresh
try { pathUpdateAgent(e, 0, gs); } catch (_) {}

    (gs.enemies || (gs.enemies = [])).push(e);

  if (typeof e.trailStrength === 'number') {
    bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
  }

  // --- Boss story hook: first time we spawn a boss this wave ---
  if (isBossEnemy(e) && !gs.__bossSpawnedThisWave) {
    gs.__bossSpawnedThisWave = true;
    gs.__bossIdThisWave      = e.id;
    try {
      window.dispatchEvent?.(
        new CustomEvent('dl-boss-appeared', {
          detail: { wave: gs.wave | 0, id: e.id, type: e.type }
        })
      );
    } catch (_) {}
  }

  return e;
}



/* --- Dev / Playtest helpers --- */
export function devSpawnEnemy(gs = state.GameState, type = 'villager', n = 1) {
  n = Math.max(1, n | 0);
  const t = state.GRID.tile || 32;

  for (let i = 0; i < n; i++) {
    const e = acquireEnemy(type, gs.wave | 0);
e.id = (++__ENEMY_ID);

if (type === 'engineer') {
  e.surfaceGraceT = 0.6;                 // seconds above ground before burrowing
  e.tunnelT = FLAGS.engineerTravelTime;  // travel time once underground
}

    // spawn at entry, facing east
    e.cx = state.ENTRY.x;
    e.cy = state.ENTRY.y;
    e.dir = 'E';

    // pixel + tile coords
    e.x = (e.cx + 0.5) * t;
    e.y = (e.cy + 0.5) * t;
    e.tileX = e.cx;
    e.tileY = e.cy;

        // --- SPAWN RENDER RESET ---
    e.drawX = e.x;
    e.drawY = e.y;
    e.prevX = e.x;
    e.prevY = e.y;

    console.debug('[spawn reset]', e.id, {
  x: e.x, y: e.y,
  drawX: e.drawX, drawY: e.drawY,
  prevX: e.prevX, prevY: e.prevY,
  ox: e.ox, oy: e.oy,
  sepX: e.sepX, sepY: e.sepY,
  sup: e._suppressSep
});

    e.ox = 0; e.oy = 0;
    e.sepX = 0; e.sepY = 0;
    e.sepOffsetX = 0; e.sepOffsetY = 0;
    e._suppressSep = false;

    e._spawnAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();

    
 // speed in pixels/sec (navigator reads this)
{
  const tsize = state.GRID.tile || 32;
  // tiles/sec (from makeEnemy scaling) → px/sec
  e.pxPerSec = (typeof e.speed === 'number') ? e.speed * tsize : 80;
  e.speedBase = e.speed;
  e.speedTilesPerSec = (typeof e.speed === 'number') ? e.speed : (e.pxPerSec / tsize);

  // heading unit vector consistent with e.dir
  const dirMap = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1] };
  const v = dirMap[e.dir] || [1,0];
  e.dirX = v[0];
  e.dirY = v[1];
}

        // seed a stable 'from' for the very first render lerp
    e.fromXY = [e.cx, e.cy];
    // mark spawn time so we can suppress offsets for a heartbeat
    e._spawnAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // normal spawn helpers
    initializeSpawnPrevAndCommit(e);

    // give dev spawns a routeSeed too so steering randomness matches waves
    e.routeSeed = e.routeSeed ?? ((Math.random() * 1e9) | 0);

    // register with new pathing and seed once (this is the missing piece)
    pathSpawnAgent(e, gs);
    try { pathUpdateAgent(e, 0, gs); } catch (_) {}

    (gs.enemies || (gs.enemies = [])).push(e);

    if (typeof e.trailStrength === 'number') {
      bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
    }

    }
  }


export function devClearEnemies(gs = state.GameState) {
  gs.enemies = [];
}

// Dev helper: return compact per-enemy debug info
export function debugEnemy(e) {
  return {
    type: e.type,
    cx: e.cx, cy: e.cy,
    x: e.x, y: e.y,
    dir: e.dir,
    distFromEntry: e.distFromEntry,
    tunneling: !!e.tunneling,
    hp: e.hp,
    updateByCombat: !!e.updateByCombat,
  };
}

// Module runtime state for the spawner / wave system
// (keeps spawn queue/timer and whether a wave is active)
const R = {
  spawning: false,
  waveActive: false,

  groupId: 0,
  groupLeaderId: null,
};


// --- Phase 5: JSON wave plan (null when not using JSON-driven waves) ---
let _jsonPlan = null; // { groups: [{ type, remaining, interval, nextAt }], startedAt }

// Warn once per wave per unknown type referenced by waves.json
let _warnedTypesThisWave = new Set();

// module-scope breath cooldown (must be top-level)
let fireCooldown = 0;

// module-scope accumulator for throttled trail decay (5 Hz)
let trailDecayAccum = 0;

// module-scope accumulator for bomb tick (1 Hz)
let bombAccum = 0;


/**
 * Dragon breath tick:
 * - builds a reachable path of tiles from the EXIT (via floodFrom)
 * - finds the nearest reachable enemy on that path
 * - spawns a flameWave effect for visuals
 * - applies damage on a cadence (fireCooldown)
 */


// One place to read an enemy's current tile (keeps combat/AI in sync)
function enemyTile(e) {
  // Prefer the navigator's authoritative grid coords:
  if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
    return { x: e.cx, y: e.cy };
  }
  // Fallback to the cached tile coords if present:
  if (Number.isInteger(e.tileX) && Number.isInteger(e.tileY)) {
    return { x: e.tileX, y: e.tileY };
  }
  // Last resort: derive from pixels:
  const t = state.GRID.tile || 32;
  return { x: Math.floor((e.x || 0) / t), y: Math.floor((e.y || 0) / t) };
}

// BFS from start (sx,sy) up to maxTiles; respects edge walls via state.isOpen(...)
function bfsFrom(gs, sx, sy, maxTiles) {
  const W = GRID.cols, H = GRID.rows;
  const dist = Array.from({ length: H }, () => new Array(W).fill(Infinity));
  const prev = Array.from({ length: H }, () => new Array(W).fill(null));
  const q = [];
  dist[sy][sx] = 0;
  q.push([sx, sy]);

  const dirs = [['E',1,0], ['W',-1,0], ['S',0,1], ['N',0,-1]];

  while (q.length) {
    const [x, y] = q.shift();
    const d = dist[y][x];
    if (d >= maxTiles) continue; // don’t explore beyond range

    for (let i = 0; i < 4; i++) {
      const [side, dx, dy] = dirs[i];
      if (!state.isOpen(gs, x, y, side)) continue;
      const nx = x + dx, ny = y + dy;
      if (!state.inBounds(nx, ny)) continue;
      if (dist[ny][nx] <= d + 1) continue;
      dist[ny][nx] = d + 1;
      prev[ny][nx] = [x, y];  // parent pointer
      q.push([nx, ny]);
    }
  }
  return { dist, prev };
}

// Reconstruct a path (array of {x,y}) from BFS prev pointers
function reconstructPath(prev, sx, sy, tx, ty) {
  if (!prev[ty] || prev[ty][tx] == null) {
    // If target is start itself
    if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
    return null;
  }
  const out = [];
  let x = tx, y = ty;
  while (!(x === sx && y === sy)) {
    out.push({ x, y });
    const p = prev[y][x];
    if (!p) return null;
    x = p[0]; y = p[1];
  }
  out.push({ x: sx, y: sy });
  out.reverse();
  return out;
}

function dragonBreathTick(gs, dt, ds) {
  fireCooldown = Math.max(0, fireCooldown - dt);
  const firePeriod = 1 / Math.max(0.0001, ds.fireRate);
  if (fireCooldown > 0) return;

  const tileSize = state.GRID.tile || 32;
  const maxTiles = Math.max(1, Math.round(ds.breathRange / tileSize));
  const mouth = state.dragonMouthCell(gs);


    // One BFS from mouth → reconstruct per-enemy corridors (cheap on 24×16)
  const { dist, prev } = bfsFrom(gs, mouth.x, mouth.y, maxTiles);

  const paths = [];
  for (const e of (gs.enemies || [])) {
    if (e.type === 'engineer' && e.tunneling) continue;
    const et = enemyTile(e);
    const d = (dist[et.y] && dist[et.y][et.x]) ?? Infinity;
    if (!Number.isFinite(d) || d <= 0 || d > maxTiles) continue;

    const p = reconstructPath(prev, mouth.x, mouth.y, et.x, et.y);
    if (!Array.isArray(p) || p.length < 2) continue;

    paths.push({ e, et, pathObjs: p, L: p.length, isHero: (e.type === 'hero') });
  }


  // No reachable target in range → small cooldown so we re-check soon
  if (paths.length === 0) { fireCooldown = firePeriod * 0.5; return; }

  // Hero shield: find the closest hero along any corridor
  let heroBlockIdx = Infinity; // index along its own path (tiles from mouth)
  for (const rec of paths) if (rec.isHero) heroBlockIdx = Math.min(heroBlockIdx, rec.L - 1);

  // Pick the corridor we will use:
  //  - among NON-heroes, choose the farthest enemy within range (so we cover more tiles)
  //  - but we will truncate the corridor if a hero is even closer
  const nonHero = paths.filter(r => !r.isHero);
  const baseRec = nonHero.length
    ? nonHero.reduce((a,b)=> (a.L>b.L ? a : b))
    : paths.reduce((a,b)=> (a.L>b.L ? a : b)); // if only hero exists, use that corridor

  // Build the corridor path (array of {x,y, dir})
  const fullPath = baseRec.pathObjs.map(p => ({ x: p.x, y: p.y }));
  // Assign dir to BOTH nodes of each edge, and seed node0 from the first edge.
  for (let i = 1; i < fullPath.length; i++) {
  const prev = fullPath[i - 1];
  const cur  = fullPath[i];
  const d = (prev.x !== cur.x) ? 'h' : 'v';
  prev.dir = d;
  cur.dir  = d;     // <- important: head node inherits too
  }
  // If there’s at least one step, ensure node0 is initialized:
  if (fullPath.length >= 2 && !fullPath[0].dir) {
  fullPath[0].dir = fullPath[1].dir;
}


  // Ensure the last node has a dir too (copy previous)
if (fullPath.length >= 2) {
  fullPath[fullPath.length - 1].dir = fullPath[fullPath.length - 2].dir;
}


  // --- Hero shield: only stop if a hero is actually ON THIS corridor
  const tkey = (x,y) => state.tileKey(x,y);
  const heroTiles = new Set(
    (gs.enemies || [])
      .filter(e => e.type === 'hero')
      .map(e => {
        const et = enemyTile(e);
        return tkey(et.x, et.y);
      })
  );
  const heroIdxOnPath = fullPath.findIndex(p => heroTiles.has(tkey(p.x, p.y)));

  // Determine how far the breath travels this shot:
//  - cannot exceed range (in tiles from the mouth)
//  - if a hero is closer, stop at the hero tile (no direct past it)
const maxIdxFromRange = Math.min(fullPath.length - 1, maxTiles);
const stopIdx = Math.min(
  maxIdxFromRange,
  (heroIdxOnPath >= 0 ? heroIdxOnPath : Infinity)
);
const travelPath = fullPath.slice(0, stopIdx + 1);


  // If we truncated, make sure the head still has a dir
if (travelPath.length >= 2 && !travelPath[travelPath.length - 1].dir) {
  travelPath[travelPath.length - 1].dir = travelPath[travelPath.length - 2].dir;
}

// Skip spawning corridor flame if it’s < 2 tiles (avoids stray 1-tile “down” draw)
if (travelPath.length < 2) {
  fireCooldown = firePeriod;
  return;
}


  const tilesPerSec = 14;
  const travelSec = travelPath.length / Math.max(1, tilesPerSec);
  
  // Remove any existing flameWave before spawning a new one (avoids overlapping artifacts)
for (let i = gs.effects.length - 1; i >= 0; i--) {
  if (gs.effects[i].type === 'flameWave') {
    // optional: releaseEffect(gs.effects[i]); // if you want to return it to the pool
    gs.effects.splice(i, 1);
  }
}

  (gs.effects || (gs.effects = [])).push(
    acquireEffect('flameWave', {
      path: travelPath, headIdx: 0, t: 0,
      tilesPerSec, widthPx: tileSize * 0.85, dur: travelSec + 0.6
    })
  );

  // Splash at the final tile (hero tile if blocked, else farthest reached)
  const hitTile = travelPath[travelPath.length - 1];
  if (hitTile) {
    (gs.effects || (gs.effects = [])).push(
      acquireEffect('fireSplash', {
        x: (hitTile.x + 0.5) * tileSize,
        y: (hitTile.y + 0.5) * tileSize,
        t: 0, dur: 0.35
      })
    );
  }

  // --- Damage: build index for fast inclusion along the corridor
  const idxByKey = new Map(travelPath.map((p,i)=>[tkey(p.x,p.y), i]));
  const lastIdx = travelPath.length - 1; // we don't apply anything beyond stopIdx

  for (const e of gs.enemies) {
    if (e.type === 'engineer' && e.tunneling) continue;
    const et = enemyTile(e);
    const idx = idxByKey.get(tkey(et.x, et.y));
    if (idx == null || idx > lastIdx) continue;

   
     const isHero = (e.type === 'hero');
    // Direct damage is blocked on and beyond the hero stop tile on THIS corridor.
    const heroStopIdx = heroIdxOnPath; // -1 means "no hero on this path"
    const canDirect = !isHero && !(
      heroStopIdx >= 0 && idx >= heroStopIdx
    );
    if (canDirect) {
      e.hp -= ds.breathPower;
      markHit(e, ds.breathPower);
    }

    // Burn applies up to the stop tile (including hero tile)
    if (ds.burnDPS > 0 && ds.burnDuration > 0) {
      e.burnDps  = ds.burnDPS;
      e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
      if (!canDirect) markHit(e, 0.0001); // show HP bar tick if only burn applied
    }
  }

  // Put breath on cooldown
  fireCooldown = firePeriod;
}


// simple in-place Fisher–Yates shuffle (used by engineer spawn spots)
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// mark an enemy as recently hit (controls HP bar visibility + timestamp)
function markHit(e, amount = 0) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  e.lastHitAt = now;
  e.showHpUntil = now + 1000; // visible for 1s since last damage tick
}


export function startWave(gs = state.GameState) {
if (!gs.cfgLoaded || !state.getCfg?.(gs)?.enemies) {
  console.warn('[waves] config not loaded yet; aborting startWave');
  return false;
}

  _warnedTypesThisWave = new Set();

  if (R.waveActive || R.spawning) return false; // simple re-entrancy guard
  // --- DEBUG: is config here yet?
console.log('[DBG startWave] cfgLoaded?', !!gs.cfgLoaded, 'hasCfg?', !!state.getCfg?.(gs));

  // ensure containers
  gs.enemies = gs.enemies || [];
  gs.effects = gs.effects || [];

 // NEW: accept waves[] either at top-level or under tuning.waves
// Prefer explicit per-wave plan if present, else derive from tuning.waves
  const waveIdx0 = Math.max(0, ((gs.wave | 0) - 1));
  const perWaveArr = state.getCfg?.(gs)?.waves;

// Prefer explicit per-wave config if present; otherwise derive from tuning.waves
  const waveRec = Array.isArray(perWaveArr) ? perWaveArr[waveIdx0] : null;

  if (waveRec && Array.isArray(waveRec.groups)) {
    _jsonPlan = makePlanFromConfig(gs, waveRec);
  } else {
    _jsonPlan = makePlanDerived(gs); // grouped plan from tuning.waves
  }

if (!_jsonPlan || !Array.isArray(_jsonPlan.groups) || _jsonPlan.groups.length === 0) {
  console.warn('[waves] plan missing/empty; aborting startWave');
  R.spawning = false;
  R.waveActive = false;
  return false;
}


  R.groupId = 0;
  R.groupLeaderId = null;
  R.spawning = true;
  R.waveActive = true;
    // Boss tracking for story system
  gs.__bossSpawnedThisWave  = false;
  gs.__bossDefeatedThisWave = false;
  gs.__bossIdThisWave       = null;


  // --- NEW: reset wave-scoped systems (junction graph, herding trail, strays) ---
  // Fresh success-trail so herding consolidates on current wave’s choices.
  ensureSuccessTrail(gs);
  // Reset the global stray counter used by the curiosity limiter.
  gs._straysActive = 0;
  // NEW: clear per-wave, per-group junction choices
  gs.groupRoutes = new Map();

  return true;
}

// Build a JSON plan from waves.json for the current wave
function makePlanFromConfig(gs, waveRec) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  // sensible defaults if the JSON omits interval/delay
  const gaps = tunedSpawnParams(gs); // seconds
  const defaultIntervalMs = Math.max(16, Math.round((gaps.spawnGap || FLAGS.spawnGap) * 1000));
  const defaultGroupGapMs = Math.max(0,  Math.round((gaps.groupGap || FLAGS.groupGap) * 1000));

  // local helpers so we don't leak globals
 const _clampIntL = (v, lo, hi) => Math.max(lo, Math.min(hi, (v|0)));
const _clampMsL  = (v, lo, hi) => Math.max(lo, Math.min(hi, (v|0)));

  const MIN_INTERVAL_MS = 16,    MAX_INTERVAL_MS = 60000;
  const MIN_DELAY_MS    = 0,     MAX_DELAY_MS    = 120000;
  const MIN_COUNT       = 1,     MAX_COUNT       = 1000;

  // roll delays forward so groups without explicit delay_ms get spaced automatically
let rollingDelay = 0;

return {
  startedAt: now,
  groups: waveRec.groups.map((g, idx) => {
    const intervalMs = _clampMsL((g.interval_ms ?? defaultIntervalMs), MIN_INTERVAL_MS, MAX_INTERVAL_MS);

    // If delay_ms is provided, honor it; else serialize after prior group's duration + groupGap.
    const delayMs = (g.delay_ms == null)
      ? rollingDelay
      : _clampMsL(g.delay_ms, MIN_DELAY_MS, MAX_DELAY_MS);

    const count = _clampIntL(g.count ?? 1, MIN_COUNT, MAX_COUNT);

    // If this group didn't specify a delay, advance rollingDelay by its actual duration plus the default group gap.
    if (g.delay_ms == null) {
      const groupDurMs = Math.max(0, count - 1) * intervalMs;
      rollingDelay += groupDurMs + defaultGroupGapMs;
    }

    return {
      type: String(g.type || 'villager'),
      remaining: count,
      interval:  intervalMs,
      nextAt:    now + delayMs,
      groupId:   0
    };
  })
};
}


// Helper: is this enemy a boss/miniboss?
function isBossEnemy(e) {
  if (!e) return false;
  if (e.boss || e.miniboss) return true;
  if (e.type === 'boss' || e.type === 'kingsguard') return true;
  if (Array.isArray(e.tags)) {
    if (e.tags.includes('boss') || e.tags.includes('miniboss')) return true;
  }
  return false;
}

// ===== Wave mix (asymptotic shares) =========================================

// Normalized share: base -> cap by wave 101, honoring minWave unlock.
// shape: default 'exp' via k; or specify {shape:'pow', a:...} or {shape:'lin'}
function _curveShare(wave, cfg = {}) {
  const base = Number(cfg.base ?? 0);
  const cap  = Number(cfg.cap  ?? 0);
  const minW = Number(cfg.minWave ?? 1);

  if (wave < minW) return 0; 

  const p = unlockedProgress(wave, minW, ENEMY_MAX_WAVE); // 0..1
  let s;
  if (cfg.shape === 'pow') {
    s = pow01(p, cfg.a ?? 1);
  } else if (cfg.shape === 'lin') {
    s = lin01(p);
  } else {
    // default: exponential tempo via k
    s = exp01(p, cfg.k ?? 3.0);
  }
  return base + (cap - base) * s;
}


// Build normalized shares Map<type, fraction 0..1> for this wave
function _computeSharesForWave(wave, mixCurves = {}, opts = {}) {
  const floor = Math.max(0, opts.floor ?? 0);
  const ceil  = Math.min(1, opts.ceil  ?? 1);
  const unlockFill = opts.unlockFill ?? 'renorm'; // 'renorm' | 'leave'

  const raw = Object.entries(mixCurves).map(([type, cfg]) => [type, Math.max(0, _curveShare(wave, cfg))]);
  let sum = raw.reduce((a, [,s]) => a + s, 0);

  // fallback: equal split among unlocked types (cap>0) if all zero
  if (sum <= 0) {
    const unlocked = raw.filter(([t]) => (mixCurves[t]?.cap ?? 0) > 0);
    if (!unlocked.length) return new Map();
    const eq = 1 / unlocked.length;
    return new Map(unlocked.map(([t]) => [t, eq]));
  }

  // normalize
  let norm = raw.map(([t, s]) => [t, s / sum]);

  // clamp then (optionally) renormalize
  let clipped = norm.map(([t, s]) => [t, Math.min(Math.max(s, floor), ceil)]);
  let clippedSum = clipped.reduce((a, [,s]) => a + s, 0);
  if (unlockFill === 'renorm' && clippedSum > 0) {
    clipped = clipped.map(([t, s]) => [t, s / clippedSum]);
  }
  return new Map(clipped);
}


function getGroupPolicy(gs, FLAGS) {
  const W  = TW(gs) || {};
  const GP = (W && W.groupPolicy) || {};

  const priority = GP.priority || {};
  const caps     = GP.caps || {};
  const forceLeaderFrom = Array.isArray(GP.forceLeaderFrom) ? GP.forceLeaderFrom.slice() : [];
  const independent = Array.isArray(GP.independent) ? GP.independent.slice() : [];
  const independentSet = new Set(independent);

  const leaderPlace = GP.leaderPlace || {};
  const defaultLeaderPlace = leaderPlace['*'] || 'front';

  const prioOf = (t) => {
    const v = priority[t];
    return Number.isFinite(v) ? v : 1000;
  };
  const capOf = (t) => (typeof caps[t] === 'number' ? Math.max(0, caps[t]|0) : Infinity);
  const leaderPlaceOf = (t) => (leaderPlace[t] || defaultLeaderPlace);

  return { prioOf, capOf, forceLeaderFrom, independentSet, leaderPlaceOf };
}

// Largest remainder: fractional shares → integer counts summing to total
function _apportion(total, sharesMap) {
  const entries = Array.from(sharesMap.entries());
  const fracs = entries.map(([t, s]) => [t, s * total]);
  let ints = fracs.map(([t, f]) => [t, Math.floor(f)]);
  let used = ints.reduce((a, [,n]) => a + n, 0);
  let left = Math.max(0, total - used);
  const rema = fracs.map(([t, f], i) => [i, f - Math.floor(f)]).sort((a,b)=>b[1]-a[1]);
  for (let k = 0; k < left && k < rema.length; k++) {
    const idx = rema[k][0];
    ints[idx][1] += 1;
  }
  return new Map(ints);
}

// Optional sparse specials (kept out of shares)
function _cadenceSpecials(wave, cadence, FLAGS) {
  const out = [];

  // Boss cadence is still “every N waves”
  const bossEvery = cadence?.bossEvery ?? FLAGS.bossEvery;

  // If truthy, we spawn a kingsguard exactly *one wave before* each boss wave
  const kgBeforeBoss = cadence?.kingsguardEvery ?? FLAGS.kingsguardEvery;

  if (bossEvery && wave % bossEvery === 0) {
    out.push('boss');
  }

  if (kgBeforeBoss && bossEvery && (wave + 1) % bossEvery === 0) {
    // i.e. waves 4, 9, 14, 19, ... when bossEvery=5
    out.push('kingsguard');
  }

  return out;
}


// Main builder: reads getCfg(gs).waves { count, mixCurves, mixOptions, cadence }
function buildWaveListFromCurves(gs, wave, W, FLAGS) {
  const C = W?.count || {};
  const baseCount = Math.round(
    Math.max(1, typeof approachCap === 'function'
      ? approachCap(C.base ?? 7, C.cap ?? 202, wave, C.k ?? 0.07)
      : (() => {
          const w = Math.max(0, (wave|0) - 1);
          const base = C.base ?? 7, cap = C.cap ?? 300, k = C.k ?? 0.07;
          return cap - (cap - base) * Math.exp(-k * w);
        })()
    )
  );

  const specials = _cadenceSpecials(wave, W?.cadence, FLAGS);
  const fillerN  = Math.max(0, baseCount - specials.length);

  // If there’s no filler this wave, return just specials (could be 0… that’s OK)
  if (fillerN === 0) return specials.slice();

  // Compute shares; if everything is zero, force a villager share
  let shares = _computeSharesForWave(wave, W?.mixCurves || {}, W?.mixOptions || {});
  if (!shares || shares.size === 0) {
    shares = new Map([['villager', 1]]);
  }

  const alloc  = _apportion(fillerN, shares);
  const list   = specials.slice();
  for (const [type, n] of alloc.entries()) for (let i = 0; i < n; i++) list.push(type);

  return list;
}


// progressWave = max(0, w - minWave + 1)
// share_raw(w) = cap - (cap - base) * e^(-k * progressWave)

// Derive a JSON-shaped plan so the game runs even without waves.json
function makePlanDerived(gs) {
   if (!gs.cfgLoaded) {
   console.warn('[waves] config not loaded yet; skipping plan');
   return { startedAt: performance.now(), groups: [] };
 }
  const now  = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const wave = (gs.wave | 0) || 1;

    // Deterministic RNG for grouping (preview == live for a given wave & config)
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function rand() {
      s = (s * 1664525 + 1013904223) >>> 0;  // simple LCG
      return s / 0xFFFFFFFF;
    };
  }
  const rand = makeRng(0x9E3779B9 ^ (wave | 0));


  // --- DEBUG: what does the config shape look like?
const __cfg = state.getCfg?.(gs);
const __tw  = __cfg?.tuning?.waves;
console.log('[DBG makePlanDerived:shape]', {
  wave,
  hasCfg: !!__cfg,
  tuning_waves_type: typeof __tw,
  tuning_waves_isArray: Array.isArray(__tw),
  has_mixCurves: !!__tw?.mixCurves,
  mixCurves_keys: __tw?.mixCurves && Object.keys(__tw.mixCurves),
  mixOptions: __tw?.mixOptions,
});



  // IMPORTANT: use TW(gs) so we tolerate any config shape
  const W = (typeof TW === 'function' ? TW(gs) : (state.getCfg?.(gs)?.tuning?.waves)) || {};

  console.log('[E makePlanDerived W]', W);

  // spawn interval from tuning (or FLAGS)
  const gaps = (typeof tunedSpawnParams === 'function') ? tunedSpawnParams(gs) : null;
  const intervalMs = Math.max(16, Math.round(((gaps?.spawnGap ?? FLAGS.spawnGap) || 0.45) * 1000));

  // Build list from curves
  let list = buildWaveListFromCurves(gs, wave, W, FLAGS);

  // --- DEBUG: see first 30 entries of the list
console.log('[DBG list from curves]', Array.isArray(list) ? list.slice(0,30) : list);

// If it failed or is empty, show why before fallback
if (!Array.isArray(list) || !list.length) {
  console.warn('[DBG curves → empty; will fallback]', {
    hasMixCurves: !!W.mixCurves,
    mixCurves: W.mixCurves,
    mixOptions: W.mixOptions,
    wave,
  });
}


  // If the curve build failed or returned empty, fall back
  if (!Array.isArray(list) || list.length === 0) {
    const count   = waveCountFor(wave, gs);
    const weights = selectWeightsForWave(wave, gs);
    const fb      = expandByWeights(weights, count);
    list = (Array.isArray(fb) && fb.length > 0)
      ? fb
      : new Array(Math.max(1, count)).fill('villager');
    console.debug('[waves] fallback mix used', { wave, count, weights, len: list.length });
  }


// === Build grouped plan (numeric priorities + caps + leader placement) ===
const groupGapMs = Math.max(0, Math.round(((gaps?.groupGap ?? FLAGS.groupGap) || 2.0) * 1000));
const gMin = Math.max(1, (gaps?.min ?? FLAGS.groupMin) | 0);
const gMax = Math.max(gMin, (gaps?.max ?? FLAGS.groupMax) | 0);

const { prioOf, capOf, forceLeaderFrom, leaderPlaceOf } = getGroupPolicy(gs, FLAGS);

// Build a pool: type -> remaining count
const pool = new Map();
for (const t of list) pool.set(t, (pool.get(t) || 0) + 1);

// Determine which types are "late" (boss / miniboss) for this wave
const lateTypes = new Set();
for (const type of pool.keys()) {
  // Always treat explicit boss/kingsguard types as late
  if (type === 'boss' || type === 'kingsguard') {
    lateTypes.add(type);
    continue;
  }
  // Also treat any enemyBase tagged as boss/miniboss as late
  try {
    const base = state.enemyBase?.(type, gs);
    if (base && Array.isArray(base.tags)) {
      if (base.tags.includes('boss') || base.tags.includes('miniboss')) {
        lateTypes.add(type);
      }
    }
  } catch (_) {
    // fail-safe: ignore errors, just don't classify as late
  }
}

// Deterministic scan order
const scanOrder = Array.from(pool.keys()).sort((a,b)=>a.localeCompare(b));

const groups = [];
let cursor = now;


function tryTake(type, takenMap) {
  const left = (pool.get(type) || 0);
  if (left <= 0) return false;
  const used = takenMap.get(type) || 0;
  if (used >= capOf(type)) return false;
  pool.set(type, left - 1);
  takenMap.set(type, used + 1);
  return true;
}

while (true) {
  // stop when pool empty, and track how many non-late enemies remain
  let totalLeft = 0;
  let nonLateRemaining = 0;
  for (const [type, left] of pool.entries()) {
    totalLeft += left;
    if (!lateTypes.has(type)) nonLateRemaining += left;
  }
  if (totalLeft <= 0) break;

  const want = Math.min(totalLeft, (groups.length % 2 === 0 ? gMax : gMin));
  const taken = new Map();
  const buffer = [];

  // 1) Choose a leader TYPE for this group (if any is available in the pool)
  //    BUT: don't use late types as leader while any non-late enemies remain.
  let leaderType = null;
  for (const lt of forceLeaderFrom) {
    const left = (pool.get(lt) || 0);
    if (left <= 0) continue;
    if (lateTypes.has(lt) && nonLateRemaining > 0) continue; // hold bosses/minibosses
    leaderType = lt;
    break;
  }

  // 2) Ensure the leader is included (if chosen), but don't decide its position yet
  if (leaderType) tryTake(leaderType, taken) && buffer.push(leaderType);

    // 3) Fill remaining slots using a weighted pick:
  //    - ignore late types while non-late enemies remain
  //    - weight by remaining pool count for variety but fair share
  while (buffer.length < want) {
    const candidates = [];
    let weightSum = 0;

    for (const t of scanOrder) {
      const left = (pool.get(t) || 0);
      if (left <= 0) continue;

      // While we still have any non-late types left in the pool,
      // do NOT fill this group with late types (boss / miniboss).
      if (lateTypes.has(t) && nonLateRemaining > 0) continue;

      const used = taken.get(t) || 0;
      if (used >= capOf(t)) continue;

      candidates.push([t, left]);
      weightSum += left;
    }

    if (!candidates.length || weightSum <= 0) break;

    // Weighted random pick: more remaining of a type => higher chance
    let r = rand() * weightSum;
    let picked = null;
    for (const [t, w] of candidates) {
      if (r <= w) { picked = t; break; }
      r -= w;
    }
    if (!picked) picked = candidates[candidates.length - 1][0];

    if (!tryTake(picked, taken)) {
      // Should be rare; just break to avoid infinite loops
      break;
    }
    buffer.push(picked);
  }

  if (buffer.length === 0) break;

  // 4) Sort by numeric priority (leader isn’t pinned yet)
  buffer.sort((a, b) => (prioOf(a) - prioOf(b)) || a.localeCompare(b));

  // 5) Place the leader according to leaderPlace (front/back/priority)
  if (leaderType) {
    const where = leaderPlaceOf(leaderType); // 'front' | 'back' | 'priority'
    if (where === 'front') {
      const i = buffer.indexOf(leaderType);
      if (i > 0) { buffer.splice(i, 1); buffer.unshift(leaderType); }
    } else if (where === 'back') {
      const i = buffer.indexOf(leaderType);
      if (i >= 0 && i !== buffer.length - 1) {
        buffer.splice(i, 1); buffer.push(leaderType);
      }
    }
  }

  const slice = buffer.slice();

  groups.push({
    type: '__mixed__',
    remaining: slice.length,
    interval: intervalMs,
    nextAt: cursor,
    groupId: 0,
    __types: slice,
    leaderType: leaderType || null
  });

  const groupDurMs = Math.max(0, (slice.length - 1)) * intervalMs;
  cursor += groupDurMs + groupGapMs;
}

return { startedAt: now, groups };
}


function clampInt(v, lo, hi) {
  v = (v|0);
  if (!Number.isFinite(v)) v = lo;
  return Math.max(lo, Math.min(hi, v));
}
function clampMs(v, lo, hi) {
  v = (v|0);
  if (!Number.isFinite(v)) v = lo;
  return Math.max(lo, Math.min(hi, v));
}

export function previewWaveList(arg) {
  const gsArg  = (arg && arg.gs) ? arg.gs : state.GameState;
  const cfgArg = arg && arg.cfg ? arg.cfg : state.getCfg?.(gsArg);
  const wave   = (typeof arg === 'number') ? (arg|0)
                : (arg && typeof arg.wave === 'number') ? (arg.wave|0)
                : ((gsArg.wave | 0) || 1);

  const waveIdx0 = Math.max(0, wave - 1);
  const waveRec = Array.isArray(cfgArg?.waves) ? cfgArg.waves[waveIdx0] : null;

  // If there is an explicit per-wave config, expand all its groups fully.
  if (waveRec && Array.isArray(waveRec.groups)) {
    const out = [];
    for (const g of waveRec.groups) {
      const t = String(g.type || 'villager');
      const c = Math.max(1, (g.count | 0) || 1);
      for (let i = 0; i < c; i++) out.push(t);
    }
    return out;
  }

  // Otherwise, derive the *full* plan from tuning.waves and flatten ALL groups.
  const fakeGs = { ...gsArg, wave };
  const plan = makePlanDerived(fakeGs);
  const out = [];
  for (const G of (plan?.groups || [])) {
    if (Array.isArray(G.__types) && G.__types.length) {
      out.push(...G.__types);
    } else {
      // fallback if a group has a single type/count
      const t = String(G.type || 'villager');
      const n = Math.max(0, G.remaining | 0);
      for (let i = 0; i < n; i++) out.push(t);
    }
  }
  return out;
}


export function previewWaveCounts(arg) {
  const list = previewWaveList(arg);
  const counts = Object.create(null);
  for (const t of list) counts[t] = (counts[t] | 0) + 1;
  return counts;
}

// Optional aliases if you ever referenced other names
export const getWavePreview = previewWaveList;
export const nextWavePlan   = previewWaveList;

// Back-compat export if main.js ever uses spawnWave
export const spawnWave = startWave;

/* =========================
 * Update loop
 * ========================= */
 export function update(gs = state.GameState, dt) {
  const enemies = gs.enemies || (gs.enemies = []);
  gs.effects = gs.effects || []; // bombs

  // Resolve knockback motion first so all subsequent systems see up-to-date positions
for (const e of enemies) {
  if (e && e.kb) tickKnockback(e, dt);
}
   
// Step surface enemies with the new navigator (skip stunned & burrowed)
{
  const tsize = state.GRID.tile || 32;
  for (const e of enemies) {
    if (!e) continue;
    if (e.type === 'engineer' && e.tunneling) continue;
    if (e.stunLeft > 0 || e.kb) continue;  // frozen OR mid-knockback


// -- Attack-zone lock: freeze & face the lair if inside the 3×1 west column --
if (isInAttackZone(gs, e.cx|0, e.cy|0)) {
  e.pausedForAttack = true;
  e.isAttacking     = true;
  e.commitDir = null;
  e.commitTilesLeft = 0;
  e.dir = 'W'; // cosmetic
  const t = state.GRID.tile || 32;
  e.x = (e.cx + 0.5) * t;
  e.y = (e.cy + 0.5) * t;
   // HARD SNAP: kill any smoothing/offset path the renderer might use
  e.drawX = e.x;           // if renderer reads drawX/drawY
  e.drawY = e.y;
  e.prevX = e.x;           // if renderer lerps from prev→draw
  e.prevY = e.y;
  e.ox = 0; e.oy = 0;      // our own per-frame offsets
  e.sepOffsetX = 0;        // sub-tile separation module (if present)
  e.sepOffsetY = 0;
  e._suppressSep = true;   // tell separation to skip this unit
  e.fromXY = [e.cx, e.cy]; // reset any nav lerp seed to current tile
  continue; // do NOT call pathUpdateAgent while in the zone
}


   // Let the navigator advance e.cx/e.cy (most implementations mutate the agent directly).
    const res = pathUpdateAgent(e, dt, gs);

    // Prefer whatever the navigator wrote; otherwise accept res.nx/ny if it returns them.
    const nx = Number.isInteger(e.cx) ? e.cx : (res && Number.isInteger(res.nx) ? res.nx : undefined);
    const ny = Number.isInteger(e.cy) ? e.cy : (res && Number.isInteger(res.ny) ? res.ny : undefined);

    if (Number.isInteger(nx) && Number.isInteger(ny)) {
      // Keep all grids in sync every frame (authoritative).
      e.cx = nx; e.cy = ny;
      e.tileX = nx; e.tileY = ny;

      // Smooth pixel placement using the pathing's render offset.
let ox = 0, oy = 0;
if (typeof pathRenderOffset === 'function') {
  try {
    const off = pathRenderOffset(e, tsize, gs); // extra args are fine if ignored
    if (Array.isArray(off) && off.length >= 2) {
      ox = Number(off[0]) || 0;
      oy = Number(off[1]) || 0;
    }
  } catch (_) { /* ignore offset errors */ }
}

// For the first ~120ms of an enemy's life, clamp offsets to zero
const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
if (e._spawnAt && (nowMs - e._spawnAt) < 120) { ox = 0; oy = 0; }

// If locked/attacking, force zero visual offsets so we draw at tile center
if (e.isAttacking || e.pausedForAttack || e._suppressSep) {
  ox = 0; oy = 0;
}
e.x = (e.cx + 0.5) * tsize + ox;
e.y = (e.cy + 0.5) * tsize + oy;


      // one-time probe (optional)
      if (!e.__navProbeOnce) {
        e.__navProbeOnce = true;
        console.log('[nav PROBE] synced', {
          id: e.id, type: e.type, cx: e.cx, cy: e.cy,
          tile: [e.tileX, e.tileY], pxps: e.pxPerSec
        });
      }
    }
  }
}


     // ---- FSM time shim ----
  const __now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (!gs.time) gs.time = { now: __now, dt, since: (t) => __now - t };
  else {
    gs.time.now = __now;
    gs.time.dt = dt;
    if (typeof gs.time.since !== 'function') gs.time.since = (t) => __now - t;
  }
  if (gs.tileSize == null) gs.tileSize = state.GRID.tile;


  // ---- Success-trail global decay (apply at 5 Hz to reduce work) ----
const T = gs.successTrail;
if (T) {
  trailDecayAccum += dt;
  const step = 0.2; // seconds
  if (trailDecayAccum >= step) {
    const steps = Math.floor(trailDecayAccum / step);
    trailDecayAccum -= steps * step;

    const decayPerSec = 0.6;
    const mul = Math.pow(Math.max(0, 1 - decayPerSec * step), steps);

    for (let y = 0; y < T.length; y++) {
      const row = T[y];
      for (let x = 0; x < row.length; x++) {
        const v = row[x] * mul;
        row[x] = (v < 1e-4) ? 0 : v;
      }
    }
  }
}


 // --- JSON-configured spawning (only path) ---
{
  const plan = _jsonPlan; // snapshot for this frame
  if (R.spawning && plan && Array.isArray(plan.groups)) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    console.debug('spawn loop gate', { spawning: R.spawning, hasPlan: !!plan, groups: plan.groups?.length, now });

    // Spawn Loop
    for (let i = 0; i < plan.groups.length; i++) {
      const G = plan.groups[i];
      if (G.remaining <= 0) continue;
      if (now < G.nextAt) continue;

      if (!G.groupId) {
        R.groupId++;
        G.groupId = R.groupId;
        R.groupLeaderId = null;
        G._spawned = 0;
        // One-time resolve of any '__mixed__' in the queued sequence
        if (Array.isArray(G.__types) && !G.__typesResolved) {
          G.__types = G.__types.map(t => t === '__mixed__' ? __resolveMixedType(gs, t) : t);
          G.__typesResolved = true;
        }
      }

      let nextType = Array.isArray(G.__types) && G.__types.length ? G.__types.shift() : G.type;
      nextType = __resolveMixedType(gs, nextType);
      const hasCfg = !!(state.getCfg?.(gs)?.enemies?.[nextType]);
      if (!hasCfg && !_warnedTypesThisWave.has(nextType)) {
        console.warn('[waves] Unknown enemy type in wave', (gs.wave|0), '→', nextType);
        _warnedTypesThisWave.add(nextType);
      }

      const e = spawnOneIntoGroup(gs, nextType, G.groupId, R.groupLeaderId);

      G._spawned = (G._spawned | 0) + 1;
      if (G._spawned === 1) e.torchBearer = true;

      if (R.groupLeaderId == null) {
        if (G.leaderType && e.type === G.leaderType) {
          R.groupLeaderId = e.id;
          e.leader = true;
          e.trailStrength = Math.max(Number(e.trailStrength) || 0.5, 1.5);
        } else if (!G.leaderType) {
          R.groupLeaderId = e.id;
          e.leader = true;
          e.trailStrength = Math.max(Number(e.trailStrength) || 0.5, 1.5);
        }
      }

      e.followLeaderId = R.groupLeaderId;

      G.remaining -= 1;
      G.nextAt = (G.interval > 0) ? (now + G.interval) : (now + 1e9);
    }

    const anyLeft = plan.groups.some(g => g.remaining > 0);
    if (!anyLeft) {
      _jsonPlan = null;     // clear AFTER finishing with `plan`
      R.spawning = false;
    }
  }
}



// --- Bomb timers (tick at 1 Hz, real time; outside enemy loop) ---
bombAccum += dt;
if (bombAccum >= 1.0) {
  const steps = Math.floor(bombAccum / 1.0);
  bombAccum -= steps * 1.0;

  for (let i = gs.effects.length - 1; i >= 0; i--) {
    const fx = gs.effects[i];
    if (fx.type !== 'bomb') continue;

    // timers are in seconds; decrement by whole seconds
    fx.timer -= steps;

    if (fx.timer <= 0) {
      const tsize = state.GRID.tile || 32;
      const bx = Math.floor((fx.x || 0) / tsize);
      const by = Math.floor((fx.y || 0) / tsize);
      const R = 1;                       // radius in tiles (Manhattan)

      // 1) Damage enemies in radius
      for (let j = gs.enemies.length - 1; j >= 0; j--) {
        const en = gs.enemies[j];
        const ex = Number.isInteger(en.tileX) ? en.tileX : (Number.isInteger(en.cx) ? en.cx : Math.floor((en.x||0)/tsize));
        const ey = Number.isInteger(en.tileY) ? en.tileY : (Number.isInteger(en.cy) ? en.cy : Math.floor((en.y||0)/tsize));
        if (!Number.isInteger(ex) || !Number.isInteger(ey)) continue;

        const dMan = Math.abs(ex - bx) + Math.abs(ey - by);
        if (dMan <= R) {
          en.hp -= (fx.dmg | 0);
          markHit(en, fx.dmg | 0);
          if (en.hp <= 0) {
            // mirror your death/reward logic
            const eg = (typeof en.gold  === 'number') ? (en.gold  | 0) : 5;
            const eb = (typeof en.bones === 'number') ? (en.bones | 0) : 1;
            gs.gold  = (gs.gold  | 0) + eg;
            gs.bones = (gs.bones | 0) + eb;
            gs.enemies.splice(j, 1);
            releaseEnemy(en);
          }
        }
      }

      // 2) Damage the dragon if any of its tiles are within radius
      let hitDragon = false;
      for (const c of state.dragonCells(gs)) {
        const dMan = Math.abs(c.x - bx) + Math.abs(c.y - by);
        if (dMan <= R) { hitDragon = true; break; }
      }

      if (hitDragon) {
        gs.dragonHP = Math.max(0, (gs.dragonHP | 0) - (fx.dmg | 0));
      }

      // (optional) add a blast FX here if you’ve got one in render
      (gs.effects || (gs.effects = [])).push(
        acquireEffect('bombBlast', {
          // center the blast where the bomb was
          x: fx.x || ((bx + 0.5) * tsize),
          y: fx.y || ((by + 0.5) * tsize),
          dur: 1.5,          // ~⅓ second flash
          rTiles: R           // reuse your logical radius (2 tiles)
        })
      );

      // Remove the bomb effect after detonation
      gs.effects.splice(i, 1);
    }
  }
}

// 2) Effects array
if (!effectsLoopLoggedOnce) {
  effectsLoopLoggedOnce = true;
  console.log('[combat] effects loop running');
}

for (let i = gs.effects.length - 1; i >= 0; i--) {
  const efx = gs.effects[i];
  if (!efx) continue;

  // Advance lifetime
  efx.t = (efx.t || 0) + dt;

  // --- Traveling flame wave along corridor ---
  if (efx.type === 'flameWave') {
    const p = efx.path || [];
    const tsize = state.GRID.tile;

    // Advance head along path by tilesPerSec
    const tilesPerSec = Math.max(1, efx.tilesPerSec || 10);
    const advance = tilesPerSec * dt;
    // accumulate fractional progress in efx._acc
    efx._acc = (efx._acc || 0) + advance;
    while (efx._acc >= 1 && efx.headIdx < p.length - 1) {
      efx.headIdx++;
      efx._acc -= 1;

      // Optional: annotate segment orientation for draw fallback
      const prev = p[efx.headIdx - 1], cur = p[efx.headIdx];
      efx._dir = (cur.x !== prev.x) ? 'h' : 'v';
      if (prev) prev.dir = efx._dir; // so renderer can read seg.dir
    }
    if (efx.headIdx >= p.length - 1 || efx.t >= (efx.dur || 0.8)) {
      gs.effects.splice(i, 1); // done
      continue;
    }
  }

  // --- Fire splash (short-lived impact) ---
  if (efx.type === 'fireSplash') {
    if (efx.t >= (efx.dur || 0.35)) {
      gs.effects.splice(i, 1);
      continue;
    }
  }

  if (efx.type === 'bombBlast') {
      if (efx.t >= (efx.dur || 0.35)) { gs.effects.splice(i, 1); continue; }
    }
  
  // --- Claw slash sprite ---
  if (efx.type === 'clawSlash') {
    const dur = Math.max(0.01, efx.dur || 2.0); // safe floor + longer default
    if (efx.t >= dur) {
      gs.effects.splice(i, 1);
      continue;
    }
  }

  // --- Wing gust travelling corridor ---
  if (efx.type === 'wingGustCorridor') {
    const path = efx.path || [];
    if (!path.length) {
      gs.effects.splice(i, 1);
      continue;
    }

    const speed = efx.speedTilesPerSec || 25; // tiles per second
    const maxIdx = path.length - 1;

    efx.headT = (efx.headT || 0) + dt * speed;
    const idx = Math.min(maxIdx, Math.floor(efx.headT));
    efx.headIdx = idx;

    if (idx >= maxIdx) {
      efx.life = (efx.life || 0) + dt;
      if (efx.life > 0.25) {        // hang around for a short moment, then vanish
        gs.effects.splice(i, 1);
        continue;
      }
    }
  }

  // --- Roar wave effect lifetime ---
  if (efx.type === 'roarWave') {
    if (efx.t >= (efx.dur || 0.40)) {
      gs.effects.splice(i, 1);
      continue;
    }
  }

  // --- Tunnel effect follows burrowed engineer ---
  if (efx.type === 'tunnel') {
    // efx follows the burrowed engineer by id
    const carrier = (gs.enemies || []).find(x => x.id === efx.targetId);
    if (carrier && carrier.tunneling) {
      efx.x = carrier.x;
      efx.y = carrier.y;
    } else {
      // Engineer surfaced or no longer exists → kill the effect
      efx.dead = true;
    }
  }

  // Stomp ripple: simple lifetime based on t/dur (managed here; shader just reads)
    if (efx.type === 'stompRipple') {
      if (efx.dur == null) efx.dur = 0.7;
      if (efx.t >= efx.dur) {
        gs.effects.splice(i, 1);
        continue;
      }
    }
  
  // After all type-specific updates, cull dead effects:
  if (efx.dead) {
    gs.effects.splice(i, 1);
    continue;
  }
}

  // 2) Enemy status (engineer tunneling, burn DoT, deaths, contact/attack)
  const exitCx = state.EXIT.x, exitCy = state.EXIT.y;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];


    // Engineers: above-ground grace → then start tunneling
if (e.type === 'engineer' && !e.tunneling) {
  if (e.surfaceGraceT > 0) {
    e.surfaceGraceT -= dt;
  } else if (!e._tunnelArmed) {
    // Arm tunneling once
    e._tunnelArmed = true;
    e.tunneling = true;
    e.updateByCombat = true;

    // choose a perimeter destination now so path is deterministic
    if (!e._tunnelDestCell) {
      const perim = dragonPerimeterTiles(gs);
      shuffle(perim);
      e._tunnelDestCell = perim[0] || { x: state.EXIT.x, y: state.EXIT.y };
    }

    // create the tracking ring effect
    (gs.effects || (gs.effects = [])).push(acquireEffect('tunnel', {
      targetId: e.id, t: 0
    }));
  }
}

   // Engineers: tunneling → smoothly move underground toward stored perimeter → surface & plant
if (e.type === 'engineer' && e.tunneling) {
  const tsize = state.GRID.tile || 32;

  // Ensure a destination picked at spawn (fallback here if missing)
  if (!e._tunnelDestCell) {
    const perim = dragonPerimeterTiles(gs);
    shuffle(perim);
    e._tunnelDestCell = perim[0] || { x: exitCx, y: exitCy };
  }

  // Cache start/dest in pixels for lerp
  if (!e._tunnelStartPx) {
    e._tunnelStartPx = { x: e.x, y: e.y };
    e._tunnelDestPx  = {
      x: (e._tunnelDestCell.x + 0.5) * tsize,
      y: (e._tunnelDestCell.y + 0.5) * tsize
    };
    e._tunnelTotal = Math.max(0.001, e.tunnelT);
    e._tunnelElapsed = 0;
  }

  // Advance timers
  const step = Math.min(dt, e.tunnelT);
  e.tunnelT -= step;
  e._tunnelElapsed = Math.min(e._tunnelTotal, (e._tunnelElapsed || 0) + step);

  // Interpolate position underground (so the ring moves)
  const u = Math.max(0, Math.min(1, e._tunnelElapsed / e._tunnelTotal));
  e.x = e._tunnelStartPx.x + (e._tunnelDestPx.x - e._tunnelStartPx.x) * u;
  e.y = e._tunnelStartPx.y + (e._tunnelDestPx.y - e._tunnelStartPx.y) * u;

  // Keep coarse tile coords roughly in sync (not strictly needed while immune)
  e.cx = Math.floor(e.x / tsize);
  e.cy = Math.floor(e.y / tsize);
  e.tileX = e.cx; e.tileY = e.cy;

  // Surface & plant when done
  if (e.tunnelT <= 0) {
    const t = tsize;
    const spot = e._tunnelDestCell;

    // snap to destination tile center and face west (toward lair)
    e.cx = spot.x; e.cy = spot.y; e.dir = 'W';
    e.x = (e.cx + 0.5) * t;
    e.y = (e.cy + 0.5) * t;
    e.tileX = e.cx;
    e.tileY = e.cy;

    // 🔧 Re-seed the navigator at the new location so it doesn't snap back to pre-tunnel tiles
    try { pathDespawnAgent?.(e); } catch (_) {}
    // (On the next update, pathUpdateAgent will spawn a fresh FSM at e.cx/e.cy.)
    
    // Exit tunneling; hand control back to FSM
    e.tunneling = false;
    e.updateByCombat = false;

    // Plant bomb at dragon perimeter, leaning toward engineer
    const dc = state.nearestDragonCell(gs, e.cx, e.cy);
    const cx = (dc.x + 0.5) * t;
    const cy = (dc.y + 0.5) * t;

    // place along the line from dragon center to engineer
    const ex = (e.cx + 0.5) * t;
    const ey = (e.cy + 0.5) * t;
    const dx = ex - cx, dy = ey - cy;
    const L  = Math.hypot(dx, dy) || 1;
    const halfTile = t * 0.5;
    const bx = cx + (dx / L) * halfTile;
    const by = cy + (dy / L) * halfTile;
    (gs.effects || (gs.effects = [])).push(
  acquireEffect('bomb', { x: bx, y: by, timer: FLAGS.engineerBombTimer, dmg: FLAGS.engineerBombDmg })
);

    // cleanup tunneling cache
    e._tunnelStartPx = e._tunnelDestPx = null;
    e._tunnelDestCell = null;
  }

  // While tunneling, skip normal surface logic this frame
  continue;
}

       
    // Burn DoT (burn always ticks; shield only blocks direct fire; burrowed enemies don't burn)
    if (e.burnLeft > 0 && e.burnDps > 0 && !(e.type === 'engineer' && e.tunneling)) {
      const tick = Math.min(dt, e.burnLeft);
      e.burnLeft -= tick;
      e.hp -= e.burnDps * tick;
      markHit(e, e.burnDps * tick);
    }

    // Stun/slow/roar-buff timers
    if (e.stunLeft > 0) e.stunLeft -= dt;
    if (e.slowLeft > 0) e.slowLeft -= dt;
    if (e.roarBuffLeft > 0) e.roarBuffLeft -= dt;

// --- Contact/zone attacks (centralized) ---
updateAttacks(gs, dt);

       // Death -> rewards (DoT, projectiles, or other effects may have killed them)
    if (e.hp <= 0) {

      // --- Boss story hook: first time boss dies this wave ---
      if (isBossEnemy(e) && !gs.__bossDefeatedThisWave) {
        gs.__bossDefeatedThisWave = true;
        try {
          window.dispatchEvent?.(
            new CustomEvent('dl-boss-defeated', {
              detail: { wave: gs.wave | 0, id: e.id, type: e.type }
            })
          );
        } catch (_) {}
      }

      const eg = (typeof e.gold  === 'number') ? (e.gold  | 0) : 5;
      const eb = (typeof e.bones === 'number') ? (e.bones | 0) : 1;
      gs.gold  = (gs.gold  | 0) + eg;
      gs.bones = (gs.bones | 0) + eb;
      enemies.splice(i, 1);
      releaseEnemy(e);
      continue;
    }

}

    // once per frame (not in any enemy loop)
    clawCooldown  = Math.max(0, clawCooldown  - dt);
    gustCooldown  = Math.max(0, gustCooldown  - dt);
    roarCooldown  = Math.max(0, roarCooldown  - dt);
    stompCooldown = Math.max(0, stompCooldown - dt);
   
  // --- Claw: high dmg melee, auto when any adjacent enemy exists (gated by CD)
  {
    const cs = state.getClawStatsTuned(gs);
    if (clawCooldown <= 0) {
      let hitAny = false;
      // strike any enemy in a tile adjacent to the dragon footprint
      for (let i = gs.enemies.length - 1; i >= 0; i--) {
        const e = gs.enemies[i];
        if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
        if (isInAttackZone(gs, e.cx, e.cy)) {
          e.hp -= cs.dmg;
          markHit(e, cs.dmg);
          hitAny = true;

          // --- Claw visual: small slash arc on the hit enemy
          {
            const tileSize = state.GRID.tile || 32;

            // Enemy center in pixels
            const ex = Number.isFinite(e.x)
              ? e.x
              : (Number.isInteger(e.cx) ? (e.cx + 0.5) * tileSize : 0);

            const ey = Number.isFinite(e.y)
              ? e.y
              : (Number.isInteger(e.cy) ? (e.cy + 0.5) * tileSize : 0);

            // Dragon center in pixels (EXIT footprint center)
            const dx = (state.EXIT.x + 0.5) * tileSize;
            const dy = (state.EXIT.y + 0.5) * tileSize;

            const angle = Math.atan2(ey - dy, ex - dx);

            spawnClawSlashEffect(gs, ex, ey, angle);
          }

          if (e.hp <= 0) {
            gs.gold  = (gs.gold  | 0) + 5;
            gs.bones = (gs.bones | 0) + 1;
            releaseEnemy(e);
            gs.enemies.splice(i, 1);
          }
        }
      }
      if (hitAny) {
        clawCooldown = cs.cd;
      }
    }
  }
  
function buildGustPathFromMouthToEntry(gs, maxTiles) {
  const mouth = state.dragonMouthCell(gs);
  if (!mouth) {
    console.warn('[gust] no dragon mouth cell');
    return null;
  }

  // How far the *visual* should extend
  const maxSteps = Math.max(1, maxTiles | 0);

  // IMPORTANT: let BFS explore the whole corridor, not just maxTiles
  // so ENTRY is always reachable if a path exists.
  const bfsRange = 999; // large enough for your map
  const { dist, prev } = bfsFrom(gs, mouth.x, mouth.y, bfsRange);

  // Use ENTRY as the outward target (toward where enemies come from)
  const entry = state.ENTRY; // or ENTRY, depending on how you expose it
  if (!entry) {
    console.warn('[gust] ENTRY tile missing on state');
    return null;
  }

  const rawPath = reconstructPath(prev, mouth.x, mouth.y, entry.x, entry.y);
  if (!Array.isArray(rawPath) || rawPath.length < 2) {
    console.warn('[gust] no path mouth→ENTRY found');
    return null;
  }

  // Now clamp the *visual* path length so it doesn't extend past gust range.
  const clamped = rawPath.slice(0, maxSteps + 1);

  // Normalize to { x, y } tile coords
  return clamped.map(seg => ({ x: seg.x, y: seg.y }));
}


  
// --- Wing Gust (button request → push away, respect walls)
if (gs.reqWingGust && gustCooldown <= 0) {
  gs.reqWingGust = false;
  globalThis.Telemetry?.log('ability:use', { key: 'gust' });

  const ps = state.getGustStatsTuned(gs);

  // Gameplay: shove enemies + bombs
  wingGustPush(gs, ps.pushTiles);

  // Visual: build a corridor path from dragon mouth → ENTRY, within push radius
  const gustPath = buildGustPathFromMouthToEntry(gs, ps.pushTiles);
  if (gustPath && gustPath.length > 1) {
    spawnWingGustCorridorFX(gs, gustPath, {
      speedTilesPerSec: 10,  // higher = faster gust
      tailLen: 4      // how long the trailing wake is
    });
  } else {
    // optional: if no path, still show a center swirl
    // spawnWingGustAtDragon(gs);
  }

  gustCooldown = ps.cd;
}



    // --- Roar (button request → stun + fear buffs)
  if (gs.reqRoar && roarCooldown <= 0) {
    gs.reqRoar = false;
    globalThis.Telemetry?.log('ability:use', { key: 'roar' });
    const rs = state.getRoarStatsTuned(gs);
    applyRoar(gs, rs);      // moved to combat/upgrades/abilities/roar.js
    roarCooldown = rs.cd;
  }


   // --- Stomp (button request → AoE slow + chip dmg)
  if (gs.reqStomp && stompCooldown <= 0) {
    gs.reqStomp = false;
    globalThis.Telemetry?.log('ability:use', { key: 'stomp' });
    const ss = state.getStompStatsTuned(gs);

    // Ability module handles gameplay + ripple spawn
    applyStomp(gs, ss, acquireEffect, markHit);

    stompCooldown = ss.cd;
  }


// 4) Dragon breath (with shield rule)
if (enemies.length > 0) {
  dragonBreathTick(gs, dt, state.getDragonStatsTuned(gs));
}


 // 5) Wave completion (hard wipe at END of wave)
if (R.waveActive && !_jsonPlan && enemies.length === 0) {
  // Clean absolutely everything that could leak into the next wave
  hardWipeActors(gs);

  globalThis.Telemetry?.log('wave:end', { wave: gs.wave | 0 });
  R.waveActive = false;
  R.spawning   = false;

  // Return to build phase, then advance the wave counter
  gs.phase = 'build';
  gs.wave  = (gs.wave | 0) + 1;
}
}
