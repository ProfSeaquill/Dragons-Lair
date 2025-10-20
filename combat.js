// combat.js (top)
import * as state from './state.js';
import { updateEnemyDistance } from './ai/metrics.js';
import { buildJunctionGraph } from './ai/topology.js';
import { computeShortestPath } from './ai/topology.js';


// === Ability cooldown timers (module-local) ===
// Initialized to 0; abilities will set cooldowns from cfg on use (ps.cd),
// and you may also reset them at wave start if desired.
let gustCooldown  = 0;
let roarCooldown  = 0;
let stompCooldown = 0;
let clawCooldown  = 0;

// Unique enemy IDs (module-local counter)
let __ENEMY_ID = 0;

// ===== Phase 9: object pools (prevent GC churn) =====
const ENEMY_POOL = new Map();   // type -> array of recycled enemies
const EFFECT_POOL = new Map();  // kind -> array of recycled effects

function acquireEnemy(type, wave, initFn) {
  const pool = ENEMY_POOL.get(type);
  let e = (pool && pool.length) ? pool.pop() : makeEnemy(type, wave);
  // RESET mutable fields fast (avoid per-spawn object literals)
  e.id = 0; e.groupId = 0; e.followLeaderId = null; e.leader = false; e.torchBearer = false;
  e.updateByCombat = !!e.updateByCombat; // preserve special flags (engineer)
  e.burnLeft = 0; e.burnDps = 0; e.stunLeft = 0; e.slowLeft = 0; e.roarBuffLeft = 0;
  e.pausedForAttack = false; e.isAttacking = false;
  e.hp = e.maxHp; e.lastHitAt = 0; e.showHpUntil = 0;

  // --- reset positional / steering state (important for pooled enemies) ---
e.x = undefined;
e.y = undefined;
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
e.commitDir = null;
e.commitSteps = 0;
e.commitTilesLeft = 0;
e.isAttacking = false;
e.pausedForAttack = false;
e.speedMul = 1;
  // Make sure behavior is present even on pooled objects
  if (!e.behavior || typeof e.behavior !== 'object') {
    const B = BEHAVIOR[type] || { sense: 0.25, herding: 1.0, curiosity: 0.15 };
    e.behavior = {
      sense:     Number(B.sense)     || 0,
      herding:   Number(B.herding)   || 0,
      curiosity: Number(B.curiosity) || 0,
    };
  }

  if (initFn) initFn(e);
  return e;
}

function releaseEnemy(e) {
  if (!e || !e.type) return;
  let pool = ENEMY_POOL.get(e.type);
  if (!pool) { pool = []; ENEMY_POOL.set(e.type, pool); }
  pool.push(e);
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


// expose cooldowns for UI
export function getCooldowns() {
  return {
    gust:  Math.max(0, gustCooldown  || 0),
    roar:  Math.max(0, roarCooldown  || 0),
    stomp: Math.max(0, stompCooldown || 0),
    claw:  Math.max(0, clawCooldown  || 0),
  };
}


// Quick helper: any tile adjacent to any dragon cell?
function isAdjacentToDragon(gs, cx, cy) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
  // Manhattan distance 1 to any dragon cell
  for (const c of state.dragonCells(gs)) {
    if (Math.abs(c.x - cx) + Math.abs(c.y - cy) === 1) return true;
  }
  return false;
}

function dragonPerimeterTiles(gs) {
  const set = new Set();
  const out = [];
  const offsets = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const c of state.dragonCells(gs)) {
    for (const [dx, dy] of offsets) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!state.inBounds(nx, ny)) continue;
      if (state.isDragonCell(nx, ny, gs)) continue;      // strictly outside
      const k = state.tileKey(nx, ny);
      if (!set.has(k)) { set.add(k); out.push({ x: nx, y: ny }); }
    }
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
    e.cx = node.x; e.cy = node.y;
    e.tileX = node.x; e.tileY = node.y;
  }

  // finished?
  if (kb.seg >= kb.path.length - 1) {
    const last = kb.path[kb.path.length - 1];
    const prev = kb.path[Math.max(0, kb.path.length - 2)];
    const t = kb.tsize;

    // snap to last tile center
    e.x = (last.x + 0.5) * t;
    e.y = (last.y + 0.5) * t;

    // face generally toward EXIT so FSM resumes sensibly
    const dx = state.EXIT.x - last.x, dy = state.EXIT.y - last.y;
    e.dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : (dy >= 0 ? 'S' : 'N');
    e.commitDir = null; e.commitSteps = 0; e.commitTilesLeft = 0;
    e.isAttacking = false; e.pausedForAttack = false;

    e.kb = null;
    return;
  }

  // interpolate within current segment
  const a = kb.path[kb.seg];
  const b = kb.path[kb.seg + 1];
  const u = Math.max(0, Math.min(1, kb.acc / kb.durPerTile));
  const t = kb.tsize;

  const ax = (a.x + 0.5) * t, ay = (a.y + 0.5) * t;
  const bx = (b.x + 0.5) * t, by = (b.y + 0.5) * t;

  e.x = ax + (bx - ax) * u;
  e.y = ay + (by - ay) * u;

  // keep facing coherent with motion
  e.dir = (bx > ax) ? 'E' : (bx < ax) ? 'W' : (by > ay) ? 'S' : 'N';
}

// Push enemies that are within `tiles` of the dragon anchor.
// Displacement falls off linearly with Manhattan distance:
//   pushSteps = max(0, tiles - distMan)
// Adjacent (dist=1) → tiles-1 steps; two tiles away (dist=2) → tiles-2 steps; etc.
function wingGustPush(gs, tiles) {
  const t = state.GRID.tile || 32;

  // Dragon anchor (centroid of dragon footprint)
  const cells = state.dragonCells(gs);
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const ax = Math.round(sx / Math.max(1, cells.length));
  const ay = Math.round(sy / Math.max(1, cells.length));

  // ---- Enemies ----
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    if (e.type === 'engineer' && e.tunneling) continue; // ← don't shove burrowers


    const dx0 = e.cx - ax, dy0 = e.cy - ay;
    const distMan = Math.abs(dx0) + Math.abs(dy0);
    if (distMan <= 0) continue;                 // sitting inside dragon; ignore
    if (distMan > tiles) continue;              // out of gust radius

    // How many tiles to push this unit (linearly decays with distance)
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

    if (nx !== e.cx || ny !== e.cy) {
  // Build the per-tile path we just traced
  const path = [{ x: e.cx, y: e.cy }];
  // Recreate the step sequence to fill the path:
  {
    const dx0 = e.cx - ax, dy0 = e.cy - ay;
    const dir = (Math.abs(dx0) >= Math.abs(dy0)) ? (dx0 >= 0 ? 'E' : 'W')
                                                 : (dy0 >= 0 ? 'S' : 'N');
    let px = e.cx, py = e.cy;
    const steps = Math.max(1, Math.abs(nx - e.cx) + Math.abs(ny - e.cy));
    for (let k = 0; k < steps; k++) {
      const step = stepIfOpen(gs, px, py, dir);
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
      durPerTile: 0.08,            // ← tune: 0.06 snappier, 0.12 chunkier
      tsize: state.GRID.tile || 32
    };
    e.isAttacking = false;
    e.pausedForAttack = false;
    e.commitDir = null; e.commitSteps = 0; e.commitTilesLeft = 0;

    markHit(e, 0.0001); // tiny tick just to show the HP bar flash
  }
}

  // ---- Bombs (optional, same falloff & walls) ----
  for (const fx of (gs.effects || [])) {
    if (fx.type !== 'bomb') continue;
    let cx = Math.floor(fx.x / t), cy = Math.floor(fx.y / t);

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
}


// Roar: stun + temporary behavior buff within range
function roarAffect(gs, rs) {
  const a = dragonAnchor(gs);
    for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    if (e.type === 'engineer' && e.tunneling) continue; // ← roar doesn’t affect burrowers
    const distMan = Math.abs(e.cx - a.cx) + Math.abs(e.cy - a.cy);
    if (distMan <= rs.rangeTiles) {
      e.stunLeft     = Math.max(e.stunLeft || 0, rs.stunSec);
      e.roarBuffLeft = Math.max(e.roarBuffLeft || 0, rs.buffDur);
      e.senseBuff    = rs.senseMult;
      e.herdingBuff  = rs.herdingMult;
      markHit(e, 0.0001);
    }
  }
  // TODO (FX): roar shockwave ring / screen shake
}

// Stomp: low dmg + slow in a big radius
function stompAffect(gs, ss) {
  const a = dragonAnchor(gs);
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const distMan = Math.abs(e.cx - a.cx) + Math.abs(e.cy - a.cy);
    if (distMan <= ss.rangeTiles) {
      e.hp -= ss.dmg;
      markHit(e, ss.dmg);
      e.slowLeft = Math.max(e.slowLeft || 0, ss.slowSec);
      e.slowMult = Math.min(e.slowMult || 1, ss.slowMult); // strongest slow wins
    }
  }
  // TODO (FX): cracks/dust ring
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

// Return nearest dragon cell (tile coords) to a given tile (ox, oy)
function nearestDragonCell(gs, ox, oy) {
  const cells = state.dragonCells(gs); // assumes you exported this from state.js
  let best = cells[0], bestD2 = Infinity;
  for (const c of cells) {
    const dx = c.x - ox, dy = c.y - oy;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  return best;
}


/* =========================
 * Enemy templates & scaling
 * ========================= */
// --- Wave progress in [0,1] where wave 1 -> 0, wave 101 -> 1
const MAX_WAVE_CAP = 101;
function waveProgress(wave, maxWave = MAX_WAVE_CAP) {
  const w = Math.max(1, wave | 0);
  return Math.min(1, (w - 1) / Math.max(1, (maxWave - 1)));
}

// Linear: early slow, exactly cap at p=1
function linCap(base, cap, p) {
  const t = Math.max(0, Math.min(1, p));
  return base + (cap - base) * t;
}

// Power curve: p^a (a>1 = slow early, a<1 = fast early), hits cap at p=1
function powCap(base, cap, p, a = 1.0) {
  const t = Math.max(0, Math.min(1, p));
  const s = Math.pow(t, Math.max(0.0001, a));
  return base + (cap - base) * s;
}

// Exponential-like (tempered) growth, normalized to reach exactly 1 at p=1
// k controls “tempo” (higher = faster early growth). Always reaches cap at p=1.
function expCap(base, cap, p, k = 3.0) {
  const t = Math.max(0, Math.min(1, p));
  const denom = 1 - Math.exp(-k);
  const s = denom > 0 ? (1 - Math.exp(-k * t)) / denom : t; // normalized
  return base + (cap - base) * s;
}

const ENEMY_MAX_WAVE = 101;
function waveP(w, max = ENEMY_MAX_WAVE) { return Math.min(1, Math.max(0, (Math.max(1, w|0)-1) / (max-1))); }
function exp01(p, k=3){ 
  const d=1-Math.exp(-k); 
  return d>0 ? (1-Math.exp(-k*p))/d : p; }
function lerpCap(base, cap, p, {shape='exp', k=3, a=1}={}) {
  const t = Math.max(0, Math.min(1, p));
  const s = shape==='lin' ? t : shape==='pow' ? Math.pow(t, Math.max(1e-4,a)) : exp01(t, k);
  return base + (cap - base) * s;
}


// How each unit tends to decide at junctions
const BEHAVIOR = {
  villager:  { sense: 0.02, herding: 2.00, curiosity: 0.55 },
  squire:    { sense: 0.3, herding: 1.40, curiosity: 0.15 },
  knight:    { sense: 0.45, herding: 0.50, curiosity: 0.10 },
  hero:      { sense: 0.80, herding: 0.20, curiosity: 0.05 },
  engineer:  { sense: 0.90, herding: 0.50, curiosity: 0.07 },
  kingsguard:{ sense: 1.50, herding: 0.10, curiosity: 0.01 },
  boss:      { sense: 2.00, herding: 0.00, curiosity: 0.00 },
};

const FLAGS = {
  kingsguardEvery: 5,        // miniboss cadence
  bossEvery: 10,             // Knight of the Round Table cadence
  engineerBombTimer: 5,     // seconds until detonation
  engineerTravelTime: 4.0,   // seconds "digging" underground before popping up
  engineerBombDmg: 35,       // damage to the dragon on bomb detonation
  spawnGap: 0.45,          // time between members in a group
  groupGap: 2.0,           // extra pause between groups
  groupMin: 6,
  groupMax: 10,
};

// -------- Wave helpers --------
function normalizedWaveProgress(wave, maxWave = MAX_WAVE_CAP) {
  const w = Math.max(1, wave | 0);
  return Math.min(1, (w - 1) / Math.max(1, (maxWave - 1)));
}

// Progress gated by unlock (minWave): 0 before unlock; 1 at maxWave
function unlockedProgress(wave, minWave = 1, maxWave = MAX_WAVE_CAP) {
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

function cadenceFor(wave, gs = state.GameState) {
  const c = TW(gs)?.cadence || {};
  return {
    bossEvery:       _val(c.bossEvery,        FLAGS.bossEvery),
    kingsguardEvery: _val(c.kingsguardEvery,  FLAGS.kingsguardEvery),
    heroFromWave:    _val(c.heroFromWave,     10),
    heroEvery:       _val(c.heroEvery,         4),
    engineerFromWave:_val(c.engineerFromWave, 20),
    engineerEvery:   _val(c.engineerEvery,     3),
  };
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

// combat.js
function makeEnemy(type, wave) {
  const base = state.enemyBase(type) || {};           // ← from enemies.json
  const es   = state.getCfg(state.GameState)?.tuning?.enemyScaling || {};

  const p    = waveP(wave, es.maxWave ?? 101);

  // Bases (with safe fallbacks)
  const hp0   = Number(base.hp)    || 10;
  const spd0  = Number(base.speed) || 1.0;           // tiles/sec
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
  if (Array.isArray(base.tags)) out.tags = [...base.tags];

  // Ensure default behavior per type
  const B = BEHAVIOR[type] || { sense: 0.25, herding: 1.0, curiosity: 0.15 };
  out.behavior = {
    sense:     Number(B.sense)     || 0,
    herding:   Number(B.herding)   || 0,
    curiosity: Number(B.curiosity) || 0,
  };
  
    // Engineer special: start underground, travel toward the lair, immune during this phase.
  if (type === 'engineer') {
    out.tunneling = true;
    out.tunnelT = FLAGS.engineerTravelTime;  // seconds underground
    // While tunneling, Combat drives them (and makes them immune to nearly everything).
    out.updateByCombat = true;
  }
  
 // (keep your special-name switch and engineer tunneling bits as you have now)
  return out;
}


/* =========================
 * Spawning
 * ========================= */

function spawnOne(gs, type) {
  const e = acquireEnemy(type, gs.wave | 0, (en) => {
    if (type === 'engineer') {
      en.tunneling = true;
      (gs.effects || (gs.effects = [])).push(acquireEffect('tunnel', {
  targetId: en.id, t: 0, dur: en.tunnelT
}));
      en.tunnelT = FLAGS.engineerTravelTime;
      en.updateByCombat = true;           // let Combat own it while burrowed
    }
  });
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';

  {
  const t = state.GRID.tile;
  e.x = (e.cx + 0.5) * t;
  e.y = (e.cy + 0.5) * t;
  e.tileX = e.cx;
  e.tileY = e.cy;
}

  // initialize prev/commit so freshly-spawned enemies head straight initially
  initializeSpawnPrevAndCommit(e);

    // Ensure FSM is initialized for this enemy
  import('./ai/fsm.js').then(m => m.initEnemyForFSM?.(e)).catch(() => {});


  gs.enemies.push(e);

if (typeof e.trailStrength === 'number') {
  bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
}

}

function spawnOneIntoGroup(gs, type, groupId, currentLeaderId) {
  const e = acquireEnemy(type, gs.wave | 0, (en) => {
    if (type === 'engineer') {
      en.tunneling = true;
      (gs.effects || (gs.effects = [])).push(acquireEffect('tunnel', {
  targetId: en.id, t: 0, dur: en.tunnelT
}));

      en.tunnelT = FLAGS.engineerTravelTime;
      en.updateByCombat = true;
    }
  });
  e.id = (++__ENEMY_ID);
  e.groupId = groupId | 0;
  e.routeSeed = e.routeSeed ?? ((Math.random() * 1e9) | 0);
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';

  {
  const t = state.GRID.tile;
  e.x = (e.cx + 0.5) * t;
  e.y = (e.cy + 0.5) * t;
  e.tileX = e.cx;
  e.tileY = e.cy;
}

  // force torch for special roles; they can overwrite leader visually, but we keep the first as leader
  if (e.type === 'hero' || e.type === 'kingsguard' || e.type === 'boss') {
    e.torchBearer = true;
    e.behavior = e.behavior && typeof e.behavior === 'object' ? e.behavior : {};
    e.behavior.sense = (Number(e.behavior.sense) || 0.5) * 1.15;
    e.trailStrength = Math.max(Number(e.trailStrength) || 0.5, 1.5);
  }

  // Each member follows the current group leader (set after the first spawn)
  e.followLeaderId = currentLeaderId ?? null;

  initializeSpawnPrevAndCommit(e);
  import('./ai/fsm.js').then(m => m.initEnemyForFSM?.(e)).catch(() => {});
  (gs.enemies || (gs.enemies = [])).push(e);

if (typeof e.trailStrength === 'number') {
  bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
}
  return e;
}


/* --- Dev / Playtest helpers --- */
export function devSpawnEnemy(gs = state.GameState, type = 'villager', n = 1) {
  n = Math.max(1, n | 0);
  const t = state.GRID.tile;

  for (let i = 0; i < n; i++) {
    const e = acquireEnemy(type, gs.wave | 0, (en) => {
    if (type === 'engineer') {
      en.tunneling = true;
      (gs.effects || (gs.effects = [])).push(acquireEffect('tunnel', {
  targetId: en.id, t: 0, dur: en.tunnelT
}));

      en.tunnelT = FLAGS.engineerTravelTime;
      en.updateByCombat = true;
    }
  });
    // spawn at entry, facing east
    e.cx = state.ENTRY.x;
    e.cy = state.ENTRY.y;
    e.dir = 'E';

    // pixel + tile coords
    e.x = (e.cx + 0.5) * t;
    e.y = (e.cy + 0.5) * t;
    e.tileX = e.cx;
    e.tileY = e.cy;

    // ✅ make speed be *pixels per second*
    // your makeEnemy() puts e.speed in tiles/sec → convert:
    if (typeof e.pxPerSec !== 'number') {
      if (typeof e.speed === 'number') {
        e.pxPerSec = e.speed * t;      // tiles/sec → px/sec
      } else {
        e.pxPerSec = 80;               // safe fallback (~2.5 tiles/s at 32px)
      }
    }
    e.speedBase = e.speed;

    // ✅ give direction vectors expected by stepAlongDirection()
    const dirMap = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1] };
    const v = dirMap[e.dir] || [1,0];
    e.dirX = v[0];
    e.dirY = v[1];

    // normal spawn helpers
    initializeSpawnPrevAndCommit(e);

    // ✅ initialize FSM bits (same as your normal spawner)
    import('./ai/fsm.js').then(m => m.initEnemyForFSM?.(e)).catch(() => {});

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

// Helper: west-most dragon tile = mouth (dragon faces west toward ENTRY)

function dragonAnchor(gs) {
  const cells = state.dragonCells(gs);
  // simple centroid of dragon tiles
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const cx = Math.round(sx / Math.max(1, cells.length));
  const cy = Math.round(sy / Math.max(1, cells.length));
  return { cx, cy };
}

function dragonMouthCell(gs) {
  const cells = state.dragonCells(gs);
  if (!cells || !cells.length) return { x: state.EXIT.x, y: state.EXIT.y };
  let best = cells[0];
  for (const c of cells) if (c.x < best.x) best = c;
  return best;
}

// One place to read an enemy's current tile (keeps combat/AI in sync)
function enemyTile(e) {
  if (Number.isInteger(e.tileX) && Number.isInteger(e.tileY)) return { x: e.tileX, y: e.tileY };
  if (Number.isInteger(e.cx)    && Number.isInteger(e.cy))    return { x: e.cx,    y: e.cy    };
  const t = state.GRID.tile || 32;
  return { x: Math.floor((e.x||0)/t), y: Math.floor((e.y||0)/t) };
}

function dragonBreathTick(gs, dt, ds) {
  fireCooldown = Math.max(0, fireCooldown - dt);
  const firePeriod = 1 / Math.max(0.0001, ds.fireRate);
  if (fireCooldown > 0) return;

  const tileSize = state.GRID.tile || 32;
  const maxTiles = Math.max(1, Math.round(ds.breathRange / tileSize));
  const mouth = dragonMouthCell(gs);

  // Build shortest paths to every reachable enemy within range
  const paths = [];
  for (const e of (gs.enemies || [])) {
    if (e.type === 'engineer' && e.tunneling) continue;
    const et = enemyTile(e);
    const p = computeShortestPath(gs, mouth.x, mouth.y, [{ x: et.x, y: et.y }]);
    if (!Array.isArray(p) || p.length === 0) continue;
    const L = p.length;              // tiles including mouth + enemy tile
    if (L > 0 && L <= maxTiles) {
      paths.push({ e, et, pathObjs: p, L, isHero: (e.type === 'hero') });
    }
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
  //  - cannot exceed range
  //  - if a hero is closer, stop at the hero tile (no direct past it)
  const farthestIdxInRange = Math.min(fullPath.length - 1, maxTiles - 1);
  const stopIdx = Math.min(
    farthestIdxInRange,
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
  console.log('[C combat.startWave]', state.getCfg(state.GameState)?.tuning?.waves);

  _warnedTypesThisWave = new Set();

  if (R.waveActive || R.spawning) return false; // simple re-entrancy guard

  // ensure containers
  gs.enemies = gs.enemies || [];
  gs.effects = gs.effects || [];

  const waveIdx0 = Math.max(0, ((gs.wave | 0) - 1));
  const cfgWaves = state.getCfg?.(gs)?.waves;

  // Always derive from tuning.json → tuning.waves
_jsonPlan = makePlanDerived(gs);

    // add this:
  console.debug('wave plan', {
    wave: gs.wave|0,
    groups: _jsonPlan?.groups?.map(g => ({
      type: g.type,
      remaining: g.remaining,
      interval: g.interval,
      hasTypesSeq: Array.isArray(g.__types)
    }))
  });

  console.debug('wave plan detail', _jsonPlan?.groups?.map(g => ({
  type: g.type,
  remaining: g.remaining,
  nextAt: g.nextAt,
  interval: g.interval,
  hasSeq: Array.isArray(g.__types) && g.__types.length
})));

  R.groupId = 0;
  R.groupLeaderId = null;
  R.spawning = true;
  R.waveActive = true;

  // --- NEW: reset wave-scoped systems (junction graph, herding trail, strays) ---
  // Rebuild (or build) the junction graph for this wave; also bumps gs.topologyVersion.
  buildJunctionGraph(gs);
  // Fresh success-trail so herding consolidates on current wave’s choices.
  ensureSuccessTrail(gs);
  // Reset the global stray counter used by the curiosity limiter.
  gs._straysActive = 0;

  return true;
}

// Build a JSON plan from waves.json for the current wave
function makePlanFromConfig(gs, waveRec) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  // sensible defaults if the JSON omits interval/delay
  const gaps = tunedSpawnParams(gs); // seconds
  const defaultIntervalMs = Math.max(16, Math.round((gaps.spawnGap || FLAGS.spawnGap) * 1000));

  // local helpers so we don't leak globals
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, (v|0)));
  const clampMs  = (v, lo, hi) => Math.max(lo, Math.min(hi, (v|0)));

  const MIN_INTERVAL_MS = 16,    MAX_INTERVAL_MS = 60000;
  const MIN_DELAY_MS    = 0,     MAX_DELAY_MS    = 120000;
  const MIN_COUNT       = 1,     MAX_COUNT       = 1000;

  return {
    startedAt: now,
    groups: waveRec.groups.map(g => ({
      type: String(g.type || 'villager'),
      remaining: clampInt(g.count ?? 1, MIN_COUNT, MAX_COUNT),
      interval:  clampMs((g.interval_ms ?? defaultIntervalMs), MIN_INTERVAL_MS, MAX_INTERVAL_MS),
      nextAt:    now + clampMs((g.delay_ms ?? 0), MIN_DELAY_MS, MAX_DELAY_MS),
      groupId: 0
    }))
  };
}


// ===== Wave mix (asymptotic shares) =========================================

// Normalized share: base -> cap by wave 101, honoring minWave unlock.
// shape: default 'exp' via k; or specify {shape:'pow', a:...} or {shape:'lin'}
function _curveShare(wave, cfg = {}) {
  const base = Number(cfg.base ?? 0);
  const cap  = Number(cfg.cap  ?? 0);
  const minW = Number(cfg.minWave ?? 1);

  if (wave < minW) return 0; 

  const p = unlockedProgress(wave, minW, MAX_WAVE_CAP); // 0..1
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
  const kgEvery = cadence?.kingsguardEvery ?? FLAGS.kingsguardEvery;
  const bossEvery = cadence?.bossEvery ?? FLAGS.bossEvery;
  if (kgEvery && wave % kgEvery === 0) out.push('kingsguard');
  if (bossEvery && wave % bossEvery === 0) out.push('boss');
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

  console.log('[D makePlanDerived pre]', state.getCfg(gs)?.tuning, state.getCfg(gs)?.tuning?.waves);

  console.log('[D2 ids]', { gsIsGameState: gs === state.GameState, hasGsCfg: !!gs.cfg, hasGameCfg: !!state.GameState.cfg });

console.log('[D3 cfg objects equal]', state.getCfg(gs) === state.getCfg(state.GameState));

console.log('[D4 shapes]', {
  tW_type: typeof state.getCfg(gs)?.tuning?.waves,
  tW_isArray: Array.isArray(state.getCfg(gs)?.tuning?.waves),
  topW_type: typeof state.getCfg(gs)?.waves,
  topW_isArray: Array.isArray(state.getCfg(gs)?.waves)
});


  // IMPORTANT: use TW(gs) so we tolerate any config shape
  const W = (typeof TW === 'function' ? TW(gs) : (state.getCfg?.(gs)?.tuning?.waves)) || {};

  console.log('[E makePlanDerived W]', W);

  // spawn interval from tuning (or FLAGS)
  const gaps = (typeof tunedSpawnParams === 'function') ? tunedSpawnParams(gs) : null;
  const intervalMs = Math.max(16, Math.round(((gaps?.spawnGap ?? FLAGS.spawnGap) || 0.45) * 1000));

  // Build list from curves
  let list = buildWaveListFromCurves(gs, wave, W, FLAGS);

  console.debug('[waves] derived raw', {
    wave,
    W_present: !!W,
    count_cfg: W?.count,
    mixCurves_keys: W?.mixCurves ? Object.keys(W.mixCurves) : '(none)',
    mixOptions: W?.mixOptions,
    cadence: W?.cadence,
    list_len: Array.isArray(list) ? list.length : 'not-array'
  });

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

  return {
    startedAt: now,
    groups: [{
      type: '__mixed__',
      remaining: list.length,
      interval: intervalMs,
      nextAt: now,
      groupId: 0,
      __types: list
    }]
  };
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

  if (waveRec && Array.isArray(waveRec.groups)) {
    const out = [];
    for (const g of waveRec.groups) {
      const t = String(g.type || 'villager');
      const c = Math.max(1, (g.count | 0) || 1);
      for (let i = 0; i < c; i++) out.push(t);
    }
    return out;
  }

  // derive (matches makePlanDerived)
  return makePlanDerived(gsArg).groups[0].__types.slice();
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
if (R.spawning && _jsonPlan && Array.isArray(_jsonPlan.groups)) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  console.debug('spawn loop gate', { spawning: R.spawning, hasPlan: !!_jsonPlan, groups: _jsonPlan?.groups?.length, now });

// Spawn Loop
  for (let i = 0; i < _jsonPlan.groups.length; i++) {
    const G = _jsonPlan.groups[i];
    if (G.remaining <= 0) continue;
    if (now < G.nextAt) continue;

    // First spawn in this JSON group → assign a groupId and reset leader
    if (!G.groupId) {
      R.groupId++;
      G.groupId = R.groupId;
      R.groupLeaderId = null;

      // Optional: warn once if type missing in cfg
      const hasCfg = !!(state.getCfg?.(gs)?.enemies?.[G.type]);
      if (!hasCfg && !_warnedTypesThisWave.has(G.type)) {
        console.warn('[waves.json] Unknown enemy type in wave', (gs.wave|0), '→', G.type);
        _warnedTypesThisWave.add(G.type);
      }
    }

    // Choose type (derived plans use a per-spawn sequence)
    const nextType =
      Array.isArray(G.__types) && G.__types.length ? G.__types.shift() : G.type;

    console.debug('spawning: before', {
     wave: gs.wave|0,
     groupIdx: i,
     groupId: G.groupId,
     nextType,
     remainingBefore: G.remaining,
     now,
     nextAt: G.nextAt,
   });

    // Spawn one member of this JSON group
    const e = spawnOneIntoGroup(gs, nextType, G.groupId, R.groupLeaderId);

    console.debug('spawning: after', {
     enemyId: e?.id,
     type: e?.type,
     pushedToEnemies: Array.isArray(gs.enemies) && gs.enemies.includes(e),
   });
    
    if (R.groupLeaderId == null) {
      R.groupLeaderId = e.id;
      e.leader = true;
     e.behavior = e.behavior && typeof e.behavior === 'object' ? e.behavior : {};
    e.behavior.sense = (Number(e.behavior.sense) || 0.5) * 1.15;
    e.trailStrength = Math.max(Number(e.trailStrength) || 0.5, 1.5);
    }
    e.followLeaderId = R.groupLeaderId;

    G.remaining -= 1;
    G.nextAt = (G.interval > 0) ? (now + G.interval) : (now + 1e9); // one-shot if no interval
  }

  // When all JSON groups are depleted, stop spawning
  const anyLeft = _jsonPlan.groups.some(g => g.remaining > 0);
  if (!anyLeft) {
    _jsonPlan = null;
    R.spawning = false;
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
      const R = 2;                       // radius in tiles (Manhattan)

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

      // Remove the bomb effect after detonation
      gs.effects.splice(i, 1);
    }
  }
}


  // 2) Effects array
  for (let i = gs.effects.length - 1; i >= 0; i--) {
    const efx = gs.effects[i];
    efx.t = (efx.t || 0) + dt;

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

    if (efx.type === 'fireSplash') {
      if (efx.t >= (efx.dur || 0.35)) { gs.effects.splice(i, 1); continue; }
    }

    // In the effects update loop:
if (efx.type === 'tunnel') {
  efx.t += dt;
  // follow the engineer by id
  const carrier = gs.enemies.find(x => x.id === efx.targetId);
  if (carrier) {
    efx.x = carrier.x; efx.y = carrier.y;
    // auto-expire when engineer surfaces
    if (!carrier.tunneling) efx.dead = true;
  } else {
    efx.dead = true;
  }
}

  }

  // 2) Enemy status (engineer tunneling, burn DoT, deaths, contact/attack)
  const exitCx = state.EXIT.x, exitCy = state.EXIT.y;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    updateEnemyDistance(e, gs);

    // Engineers: tunneling -> pop near dragon -> plant bomb
    if (e.type === 'engineer' && e.tunneling) {
      e.tunnelT -= dt;
      if (e.tunnelT <= 0) {
        const perim = dragonPerimeterTiles(gs);
shuffle(perim);
const spot = perim[0] || { x: exitCx, y: exitCy }; // absolute fallback; will be adjusted below
       
        // Hoist tile size ONCE here:
        const t = state.GRID.tile;
        
        // --- snap to tile & face lair
        e.cx = spot.x; e.cy = spot.y; e.dir = 'W';
        e.x = (e.cx + 0.5) * t;
        e.y = (e.cy + 0.5) * t;
        e.tileX = e.cx;
        e.tileY = e.cy;

        // --- exit tunneling, resume normal FSM control
        e.tunneling = false;
        e.updateByCombat = false;

        // (optional) re-init FSM kinematics if needed
        import('./ai/fsm.js').then(m => m.initEnemyForFSM?.(e)).catch(()=>{});

        // Plant bomb at dragon perimeter (or center of nearest dragon cell)
        const PLACE_MODE = 'perimeter'; // 'perimeter' | 'center'
        const dc = nearestDragonCell(gs, e.cx, e.cy);

        // Center of that dragon tile
        const cx = (dc.x + 0.5) * t;
        const cy = (dc.y + 0.5) * t;

        let bx = cx, by = cy;
        if (PLACE_MODE === 'perimeter') {
          // Place along the line from dragon center toward the engineer, at the tile edge
          const ex = (e.cx + 0.5) * t;
          const ey = (e.cy + 0.5) * t;
          const dx = ex - cx, dy = ey - cy;
          const L  = Math.hypot(dx, dy) || 1;
          const halfTile = t * 0.5;
          bx = cx + (dx / L) * halfTile;
          by = cy + (dy / L) * halfTile;
        }

        gs.effects.push(acquireEffect('bomb', { x: bx, y: by, timer: FLAGS.engineerBombTimer, dmg: FLAGS.engineerBombDmg }));

      }
    }

    // Burn DoT (burn always ticks; shield only blocks direct fire)
    if (e.burnLeft > 0 && e.burnDps > 0) {
      const tick = Math.min(dt, e.burnLeft);
      e.burnLeft -= tick;
      e.hp -= e.burnDps * tick;
      markHit(e, e.burnDps * tick);
    }

    // Stun/slow/roar-buff timers
    if (e.stunLeft > 0) e.stunLeft -= dt;
    if (e.slowLeft > 0) e.slowLeft -= dt;
    if (e.roarBuffLeft > 0) e.roarBuffLeft -= dt;

    // Death -> rewards (DoT, projectiles, or other effects may have killed them)
    if (e.hp <= 0) {
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
        if (isAdjacentToDragon(gs, e.cx, e.cy)) {
          e.hp -= cs.dmg;
          markHit(e, cs.dmg);
          hitAny = true;
          // optional: add a slash FX in render using gs.effects
          if (e.hp <= 0) {
            gs.gold  = (gs.gold  | 0) + 5;
            gs.bones = (gs.bones | 0) + 1;
            releaseEnemy(e);
            gs.enemies.splice(i, 1);
          }
        }
      }
      if (hitAny) clawCooldown = cs.cd;
    }
  }

  // --- Wing Gust (button request → push away, respect walls)
  if (gs.reqWingGust && gustCooldown <= 0) {
    gs.reqWingGust = false;
    globalThis.Telemetry?.log('ability:use', { key: 'gust' });
    const ps = state.getGustStatsTuned(gs);
    wingGustPush(gs, ps.pushTiles);
    gustCooldown = ps.cd;
  }

  // --- Roar (button request → stun + fear buffs)
  if (gs.reqRoar && roarCooldown <= 0) {
    gs.reqRoar = false;
    globalThis.Telemetry?.log('ability:use', { key: 'roar' });
    const rs = state.getRoarStatsTuned(gs);
    roarAffect(gs, rs);
    roarCooldown = rs.cd;
  }

  // --- Stomp (button request → AoE slow + chip dmg)
  if (gs.reqStomp && stompCooldown <= 0) {
    gs.reqStomp = false;
    globalThis.Telemetry?.log('ability:use', { key: 'stomp' });
    const ss = state.getStompStatsTuned(gs);
    stompAffect(gs, ss);
    stompCooldown = ss.cd;
  }

// 4) Dragon breath (with shield rule)
if (enemies.length > 0) {
  dragonBreathTick(gs, dt, state.getDragonStatsTuned(gs));
}


 // 5) Wave completion
if (R.waveActive && !_jsonPlan && enemies.length === 0) {
  globalThis.Telemetry?.log('wave:end', { wave: gs.wave | 0 });
  R.waveActive = false;
  R.spawning   = false;
  gs.wave = (gs.wave | 0) + 1;
}
}
