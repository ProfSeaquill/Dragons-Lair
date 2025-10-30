// state.js — per-edge wall model + core game state + helpers

// ===== Grid & Entry/Exit =====
export const GRID = { cols: 24, rows: 16, tile: 32 };

export const ENTRY = { x: 0, y: Math.floor(GRID.rows / 2) };
export const EXIT  = { x: GRID.cols - 2, y: Math.floor(GRID.rows / 2) };

// near the top of state.js
export const DRAGON_BASE = {
  maxHP: 100,
  breathPower: 14,
  fireRate: 0.5,
  breathRange: 15 * GRID.tile,
  burnDPS: 2,
  burnDuration: 2,
  breathWidth: GRID?.tile ?? 32
};

export const DEFAULT_CFG = {
  tuning: { 
  dragon: { maxHP: 100, healCostBone: 1 }, 
    flame: {}, 
    waves: {},
    economy: { wallCostBones: 1, wallRefundBones: 0 } 
  },
  enemies: {},
  waves: []
};

export function getCfg(gs) {
  return (gs && gs.cfg) ? gs.cfg : DEFAULT_CFG;
}

export function applyConfig(gs, cfg) {
  const rawTuning = cfg?.tuning || {};
  const tuningObj = rawTuning && rawTuning.tuning ? rawTuning.tuning : rawTuning;

  gs.cfg = {
    tuning:  { ...DEFAULT_CFG.tuning,  ...tuningObj },
    enemies: { ...DEFAULT_CFG.enemies, ...(cfg?.enemies || {}) },
    waves:   Array.isArray(cfg?.waves) ? cfg.waves : DEFAULT_CFG.waves,
    upgrades: {}  // runtime levels only; rows come from upgrades.js (buildUpgradeRows)
  };

  gs.dragonHPMax = (gs.cfg.tuning.dragon.maxHP | 0) || 100;
  gs.cfgLoaded = true;  // runtime flag
}

export function bumpTopology(gs, reason) {
  // Only allow in build-phase unless an explicit allow window is open
  if (gs.phase !== 'build' && !gs._allowTopoBump) return false;
  gs.topologyVersion = (gs.topologyVersion | 0) + 1;
  return true;
}

// If you added healDragon earlier, keep it but read from cfg:
export function healDragon(gs) {
  const cfg = getCfg(gs);
  const maxHP     = (gs.dragonHPMax ?? cfg.tuning.dragon.maxHP) | 0;
  const costPerHP = (cfg.tuning.dragon.healCostBone | 0) || 1;
  const hp        = gs.dragonHP | 0;
  const bones     = gs.bones | 0;

  if (hp >= maxHP) return { healed: 0, reason: 'full' };
  if (bones < costPerHP) return { healed: 0, reason: 'no_bones' };

  const deficitHP   = maxHP - hp;
  const maxHealable = Math.floor(bones / Math.max(1, costPerHP));
  const healed      = Math.min(deficitHP, maxHealable);

  gs.bones    = bones - healed * costPerHP;
  gs.dragonHP = hp + healed;
  return { healed, reason: 'ok' };
}

// Build-mode gate: allow editing only when no living enemies exist
export function canEditMaze(gs = GameState) {
  const alive = Array.isArray(gs.enemies) && gs.enemies.some(e => e && !e.dead);
  return !alive && !gs.gameOver; // true only between waves
}

// --- TEST HOOKS (used only by tests) ---
export const __testHooks = Object.create(null);

// ===== Economy / Costs =====
export const COSTS = {
  edgeWall: 1,   // bones to place an edge wall
  edgeRefund: 0, // bones refunded on removal
  healPerBone: 1 // 1 HP per 1 bone
};

// --- Dragon hitbox config (in tiles), centered on the EXIT tile
export const DRAGON_HITBOX = {
  w: 3,   // width in tiles  (try 3, 4, or 5)
  h: 3,   // height in tiles (try 3, 4, or 5)
};

export const flameTune = (gs) => (getCfg(gs)?.tuning?.flame) || {};

function _dragonCellsImpl(gs) {
const { x: cx, y: cy } = EXIT; // EXIT is the lair mouth tile
  const halfW = Math.floor(DRAGON_HITBOX.w / 2);
  const halfH = Math.floor(DRAGON_HITBOX.h / 2);

  const cells = [];
  for (let dy = -halfH; dy <= halfH; dy++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      const x = cx + dx, y = cy + dy;
      if (inBounds(x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

export function dragonCells(gs) {
  return (typeof __testHooks?.dragonCells === 'function')
    ? __testHooks.dragonCells(gs)
    : _dragonCellsImpl(gs);
}

// Fast check for a single tile
export function isDragonCell(x, y, gs) {
  const list = dragonCells(gs);
  for (let i = 0; i < list.length; i++) {
    if (list[i].x === x && list[i].y === y) return true;
  }
  return false;
}


// ===== Ability Upgrade Levels =====
// (0 = base; you can unlock/level these however you like)
export const upgrades = {
  claw:  0,
  gust:  0,
  roar:  0,
  stomp: 0,
};

// --- tiny helpers for scaling
function stepDownCooldown(base, min, level, every, factor) {
  // every N levels, cooldown *= factor; clamp to min
  const steps = Math.floor(level / every);
  return Math.max(min, base * Math.pow(factor, steps));
}
function lin(base, perLvl, level) { return base + perLvl * level; }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }

// --- smooth asymptotic growth: starts at base, rises quickly, then approaches cap
function approachCap(base, cap, level, k) {
  const L = Math.max(0, level | 0);
  const b = Number(base) || 0;
  const c = Number(cap);
  const kk = (k == null) ? 0.07 : Number(k);
  if (!Number.isFinite(c)) return b;     // guard if cap not provided
  return c - (c - b) * Math.exp(-kk * L);
}

// Smoothly decreases a value toward a floor (e.g., cooldown toward a minimum).
// base: starting value at level 0
// min:  asymptotic floor you approach as level ↑
// level: upgrade level (≥0)
// k:     tempo (higher → approaches min faster)
function approachMin(base, min, level, k = 0.07) {
  const L = Math.max(0, level | 0);
  const b = Number(base) || 0;
  const m = Number(min)  || 0;
  return m + (b - m) * Math.exp(-k * L);
}

// ==== Finite-horizon (finish exactly at L = 30) ====
const MAX_UPGRADE_LVL = 30;

function levelProgress(level, max = MAX_UPGRADE_LVL) {
  const L = Math.max(0, level|0);
  return Math.min(1, L / Math.max(1, max|0));
}

// Shapes that map progress p∈[0,1] → s∈[0,1], with s(1)=1.
function exp01(p, k = 3.0) {
  const t = Math.max(0, Math.min(1, p));
  const denom = 1 - Math.exp(-k);
  return denom > 1e-9 ? (1 - Math.exp(-k * t)) / denom : t; // linear if k≈0
}
function pow01(p, a = 1.0) {
  const t = Math.max(0, Math.min(1, p));
  return Math.pow(t, Math.max(1e-4, a));
}
function lin01(p) { return Math.max(0, Math.min(1, p)); }

// Interpolate base→cap at finite max level
function lerpToCap(base, cap, level, { shape = 'exp', k = 3.0, a = 1.0, max = MAX_UPGRADE_LVL } = {}) {
  const p = levelProgress(level, max);
  let s;
  if (shape === 'pow') s = pow01(p, a);
  else if (shape === 'lin') s = lin01(p);
  else s = exp01(p, k); // default exponential tempo
  return base + (cap - base) * s;
}

// Interpolate base→floor (monotone down) at finite max level
function lerpDownToFloor(base, floor, level, opts) {
  // reuse lerpToCap by flipping signs
  const up = lerpToCap(0, base - floor, level, opts);
  return base - up;
}

// ===== Phase 6: tuned wrappers (non-breaking) =====

function _cfg(gs) { return (getCfg?.(gs) ?? {}).tuning ?? {}; }
function _lvl(gs, keyPrefix) {
  // Count how many upgrades matching a prefix were bought (e.g., "claw_dmg_")
  const U = (gs && gs.upgrades) || {};
  let n = 0;
  for (const k in U) if (U[k] && k.startsWith(keyPrefix)) n += (U[k] | 0);
  return n | 0;
}

export function enemyBase(type, gs = GameState) {
  return (getCfg(gs)?.enemies?.[type]) || null; // {hp,speed,rate,damage,range,...}
}

// keep your base helper (or add if you don't have it yet)
export function getDragonStatsBase(gs = GameState) {
  const t = getCfg(gs)?.tuning?.flame || {};
  // prefer tuning.json if present; else fallback to the hardcoded DRAGON_BASE
  return {
    maxHP:      getCfg(gs)?.tuning?.dragon?.maxHP ?? DRAGON_BASE.maxHP,
    breathPower:  (typeof t.dmgPerHit      === 'number') ? t.dmgPerHit      : DRAGON_BASE.breathPower,
    fireRate:     (typeof t.fireRate       === 'number') ? t.fireRate       : DRAGON_BASE.fireRate,
    breathRange:  (typeof t.baseRangeTiles === 'number') ? t.baseRangeTiles * GRID.tile : DRAGON_BASE.breathRange,
    burnDPS:      (typeof t.burnDps        === 'number') ? t.burnDps        : DRAGON_BASE.burnDPS,
    burnDuration: (typeof t.burnDuration   === 'number') ? t.burnDuration   : DRAGON_BASE.burnDuration,
    breathWidth: DRAGON_BASE.breathWidth
  };
}


export function getDragonStatsTuned(gs) {
  const base = getDragonStatsBase(gs);
  const T = flameTune(gs);

  // current upgrade levels
  const lvPower = (gs?.upgrades?.power | 0) || 0;
  const lvRate  = (gs?.upgrades?.rate  | 0) || 0;
  const lvRange = (gs?.upgrades?.range | 0) || 0;
  const lvBurn  = (gs?.upgrades?.burn  | 0) || 0;

  // bases (tuning overrides fall back to old base)
  const basePower = (typeof T.baseDamage     === 'number') ? T.baseDamage     : base.breathPower;
  const baseRate  = (typeof T.fireRate       === 'number') ? T.fireRate       : base.fireRate;
  const baseTiles = (typeof T.baseRangeTiles === 'number') ? T.baseRangeTiles : (base.breathRange / GRID.tile);
  const baseBurn  = (typeof T.burnDps        === 'number') ? T.burnDps        : base.burnDPS;
  const baseBurnS = (typeof T.burnDuration   === 'number') ? T.burnDuration   : base.burnDuration;

  // === New finite-horizon caps (L=30 == MAX) =========================
  // Upgrades obey the “10% less effective vs. max-wave enemies” rule:
  const enemyScaleAtMax = Number(T.enemyHpScaleAtMax ?? 100); // e.g. 100x
  const effAtMax        = Number(T.efficiencyAtMax ?? 0.90);  // 0.90 = 10% less effective
  const S = Math.max(0, enemyScaleAtMax * effAtMax);

  // Derive offensive caps from that single S:
  const capPower   = (T.capDamage    != null) ? T.capDamage    : basePower * S;
  const capRate    = (T.capRate      != null) ? T.capRate      : baseRate  * S;
  const capBurnDps = (T.capBurnDps   != null) ? T.capBurnDps   : baseBurn  * S;

  // Burn duration/range can be independent (range isn’t “HP effectiveness”):
  const capBurnDur   = (T.capBurnDuration   != null) ? T.capBurnDuration   : baseBurnS * (T.burnDurationScaleAtMax ?? 1.5);
  const capRangeTile = (T.capRangeTiles     != null) ? T.capRangeTiles     : baseTiles * (T.rangeScaleAtMax ?? 2.0);

  // Per-stat shape/tempos are tunable; sensible defaults given:
  const dmg = lerpToCap(basePower,   capPower,   lvPower, { shape: T.dmgShape  || 'exp', k: T.kDamage  ?? 3.0, a: T.aDamage  ?? 1.0 });
  const rps = lerpToCap(baseRate,    capRate,    lvRate,  { shape: T.rateShape || 'exp', k: T.kRate    ?? 2.5, a: T.aRate    ?? 1.0 });
  const rng = lerpToCap(baseTiles,   capRangeTile, lvRange,{ shape: T.rangeShape|| 'pow', a: T.aRange   ?? 1.2, k: T.kRange   ?? 2.0 });
  const bps = lerpToCap(baseBurn,    capBurnDps, lvBurn,  { shape: T.burnShape || 'exp', k: T.kBurnDps ?? 2.5, a: T.aBurnDps ?? 1.0 });
  const bdu = lerpToCap(baseBurnS,   capBurnDur, lvBurn,  { shape: T.bdurShape || 'lin' });

  return {
    ...base,
    breathPower: Math.max(0, dmg),
    fireRate:    Math.max(0.01, rps),
    breathRange: Math.max(1, rng) * GRID.tile,
    burnDPS:     Math.max(0, bps),
    burnDuration:Math.max(0, bdu),
  };
}



// CLaw: damage ↑ to capDmg, cooldown ↓ to minCd
export function getClawStatsTuned(gs) {
  const lv = Math.max(0, (gs?.upgrades?.claw|0));
  const t = getCfg(gs)?.tuning?.claw || {};
  const baseD = 100, capD = t.capDamage ?? 500;
  const baseC = t.baseCooldownSec ?? 10.0, floorC = t.minCooldownSec ?? 1.0;

  return {
    dmg: Math.round(lerpToCap(baseD, capD, lv, { shape: t.dmgShape || 'exp', k: t.kDamage ?? 2.5 })),
    cd:  lerpDownToFloor(baseC, floorC, lv, { shape: t.cdShape || 'exp', k: t.kCooldown ?? 2.5 })
  };
}

export function getGustStatsTuned(gs) {
  const lv = Math.max(0, (gs?.upgrades?.gust|0));
  const t = getCfg(gs)?.tuning?.gust || {};
  const baseP = 2, capP = t.capPushTiles ?? 6;
  const baseC = t.baseCooldownSec ?? 30.0, floorC = t.minCooldownSec ?? 5.0;

  return {
    pushTiles: Math.round(lerpToCap(baseP, capP, lv, { shape: t.pushShape || 'exp', k: t.kPush ?? 2.5 })),
    cd:        lerpDownToFloor(baseC, floorC, lv, { shape: t.cdShape || 'exp', k: t.kCooldown ?? 2.5 })
  };
}

export function getRoarStatsTuned(gs) {
  const lv = Math.max(0, (gs?.upgrades?.roar|0));
  const t = getCfg(gs)?.tuning?.roar || {};
  const baseS = 1.5, capS = t.capStunSec ?? 5.0;
  const baseC = t.baseCooldownSec ?? 60.0, floorC = t.minCooldownSec ?? 15.0;

  return {
    rangeTiles: (GRID.cols + GRID.rows), // unchanged
    senseMult:  1.4,
    herdingMult:1.5,
    buffDur:    5,
    stunSec:    lerpToCap(baseS, capS, lv, { shape: t.stunShape || 'exp', k: t.kStun ?? 2.5 }),
    cd:         lerpDownToFloor(baseC, floorC, lv, { shape: t.cdShape || 'exp', k: t.kCooldown ?? 2.5 }),
  };
}

export function getStompStatsTuned(gs) {
  const lv = Math.max(0, (gs?.upgrades?.stomp|0));
  const t = getCfg(gs)?.tuning?.stomp || {};
  const baseD = 20, capD = t.capDamage ?? 100;
  const baseSlow = 0.80, floorSlow = t.floorSlowMult ?? 0.30;
  const baseC = t.baseCooldownSec ?? 30.0, floorC = t.minCooldownSec ?? 10.0;

  return {
    rangeTiles: (GRID.cols + GRID.rows),
    slowMult:   lerpDownToFloor(baseSlow, floorSlow, lv, { shape: t.slowShape || 'exp', k: t.kSlow ?? 2.5 }),
    slowSec:    3.0,
    dmg:        Math.round(lerpToCap(baseD, capD, lv, { shape: t.dmgShape || 'exp', k: t.kDamage ?? 2.5 })),
    cd:         lerpDownToFloor(baseC, floorC, lv, { shape: t.cdShape || 'exp', k: t.kCooldown ?? 2.5 }),
  };
}

// keep alias so legacy imports work
export { getDragonStatsTuned as getDragonStats };
export { getClawStatsTuned   as getClawStats };
export { getGustStatsTuned   as getGustStats };
export { getRoarStatsTuned   as getRoarStats };
export { getStompStatsTuned  as getStompStats };

// ===== Utility: Field allocation =====
export function makeScalarField(w, h, fill = 0) {
  const a = new Array(h);
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    for (let x = 0; x < w; x++) row[x] = fill;
    a[y] = row;
  }
  return a;
}

// ===== Helpers: keys, bounds =====
export const tileKey = (x, y) => `${x},${y}`;

// Keep the real logic private:
function _inBoundsImpl(x, y) {
  return x >= 0 && y >= 0 && x < GRID.cols && y < GRID.rows;
}

// Public export delegates to a test override if present
export function inBounds(x, y) {
  return (typeof __testHooks.inBounds === 'function')
    ? __testHooks.inBounds(x, y)
    : _inBoundsImpl(x, y);
}


// ===== Game State (single mutable object) =====
export const GameState = {
  version: 2,
  wave: 1,
  gold: 0,
  bones: 0,
  dragonHP: DRAGON_BASE.maxHP,
  autoStart: false,
  topologyVersion: 0,   // bumped whenever walls/topology change

  // tracks when we're in a wave
  phase: 'build', // 'build' | 'wave'
  
  // Visual-only dragon breath (mouth burst / sprite timing)
  dragonFX: { attacking: false, t: 0, dur: 0.5 },

  // Simulation containers
  enemies: [],
  projectiles: [],
  effects: [],

    // Ability upgrades + UI requests (set by HUD buttons)
  upgrades: { ...upgrades },   // levels
  reqWingGust: false,
  reqRoar:     false,
  reqStomp:    false,

  // Per-cell edge walls: Map<"x,y", {N,E,S,W:boolean}>
  cellWalls: new Map(),

  // Fields used by pathing/AI
  distFromEntry: makeScalarField(GRID.cols, GRID.rows, Infinity),
  distToExit:    makeScalarField(GRID.cols, GRID.rows, Infinity),
  successTrail:  makeScalarField(GRID.cols, GRID.rows, 0),
  groupRoutes: new Map(), // Map<groupId:number, Map<junctionId:string, dir:'N'|'E'|'S'|'W'>>

  // RNG / misc
  seed: 0,

  // Dev / Playtest flags (not required, but handy)
  dev: {
    infiniteMoney: false,  // if true, UI will keep gold/bones topped up
  },
};

// ===== Per-Cell Edge Accessors =====
// If callers forget to pass gs, fall back to the singleton GameState.
function __useGS(g) { return g || GameState; }

export function ensureCell(gs, x, y) {
  gs = __useGS(gs);
  const k = tileKey(x, y);
  let rec = gs.cellWalls.get(k);
  if (!rec) { rec = { N: false, E: false, S: false, W: false }; gs.cellWalls.set(k, rec); }
  return rec;
}

export function isOpen(gs, x, y, side) {
  gs = __useGS(gs);
  if (!inBounds(x, y)) return false;
  const here = ensureCell(gs, x, y);
  if (here[side] === true) return false;

  let nx = x, ny = y, opp;
  switch (side) {
    case 'N': ny = y - 1; opp = 'S'; break;
    case 'S': ny = y + 1; opp = 'N'; break;
    case 'E': nx = x + 1; opp = 'W'; break;
    case 'W': nx = x - 1; opp = 'E'; break;
    default: return false;
  }
  if (!inBounds(nx, ny)) return false;
  const there = ensureCell(gs, nx, ny);
  return there[opp] === false;
}

export function neighborsByEdges(gs, cx, cy) {
  gs = __useGS(gs);
  const out = [];
  if (isOpen(gs, cx, cy, 'N')) out.push({ x: cx,     y: cy - 1, side: 'N' });
  if (isOpen(gs, cx, cy, 'E')) out.push({ x: cx + 1, y: cy,     side: 'E' });
  if (isOpen(gs, cx, cy, 'S')) out.push({ x: cx,     y: cy + 1, side: 'S' });
  if (isOpen(gs, cx, cy, 'W')) out.push({ x: cx - 1, y: cy,     side: 'W' });
  return out;
}

export function setEdgeWall(gs, x, y, side, hasWall) {
  gs = __useGS(gs);
  if (!inBounds(x, y)) return false;
  const here = ensureCell(gs, x, y);
  let nx = x, ny = y, opp;
  switch (side) {
    case 'N': ny = y - 1; opp = 'S'; break;
    case 'S': ny = y + 1; opp = 'N'; break;
    case 'E': nx = x + 1; opp = 'W'; break;
    case 'W': nx = x - 1; opp = 'E'; break;
    default: return false;
  }
  if (!inBounds(nx, ny)) return false;

  const there = ensureCell(gs, nx, ny);
  here[side] = !!hasWall;
  there[opp] = !!hasWall;
  gs.topologyVersion = (gs.topologyVersion|0) + 1;  // <— bump once per successful change
  return true;
}

// --- Maze presets: serialize/apply just the walls (no gold/wave changes) ---
export function serializeMaze(gs) {
  gs = __useGS(gs);
  const edges = [];
  // Serialize only "N" and "W" to avoid double-counting shared edges.
  for (const [k, rec] of gs.cellWalls.entries()) {
    const [xStr, yStr] = k.split(',');
    const x = xStr|0, y = yStr|0;
    if (rec.N) edges.push([x, y, 'N']);
    if (rec.W) edges.push([x, y, 'W']);
  }
  return edges; // compact: array of [x,y,side]
}

export function clearMaze(gs) {
  gs = __useGS(gs);
  gs.cellWalls.clear();
  gs.topologyVersion = (gs.topologyVersion || 0) + 1;
}

export function applyMaze(gs, edges) {
  gs = __useGS(gs);
  clearMaze(gs);
  gs._allowTopoBump = true;
  try {
    if (Array.isArray(edges)) {
      for (const [x,y,side] of edges) setEdgeWall(gs, x|0, y|0, side, true);
    }
    bumpTopology(gs, 'applyMaze');
  } finally {
    gs._allowTopoBump = false;
  }
}


// ===== Phase 7: Robust saves (versioned + migration) =====
export const SAVE_SCHEMA_VERSION = 2;

// Tiny migrate: fills defaults when older saves are loaded
export function migrateSave(save) {
  if (!save || typeof save !== 'object') return null;
  const v = (save.schemaVersion | 0) || 1;
  // v1 -> v2: add schemaVersion, createdAt if missing; keep payload as-is
  if (v <= 1) {
    save.schemaVersion = 2;
    if (!save.createdAt) save.createdAt = Date.now();
    // Future migrations can fill new top-level fields here.
  }
  // Always ensure these exist post-migration
  if (!save.schemaVersion) save.schemaVersion = SAVE_SCHEMA_VERSION;
  if (!save.createdAt) save.createdAt = Date.now();
  return save;
}

// Best-effort clear (keeps compatibility if key ever changed)
export function clearSave() {
  try {
    const keys = [
      'dl.save', 'dl-save', 'dragon.save', 'dragons-lair.save',  // common variants
    ];
    let removed = false;
    for (const k of keys) if (localStorage.getItem(k) != null) {
      localStorage.removeItem(k);
      removed = true;
    }
    // If your saveState uses a specific key, removing above will no-op; the call below
    // lets your existing implementation handle it if you keep an internal key.
    if (typeof __clearSaveInternal === 'function') __clearSaveInternal();
    return removed;
  } catch {
    return false;
  }
}

// ===== Saving / Loading =====
const LS_KEY = 'dragons-lair-save';

export function saveState(gs) {
  try {
    const payload = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      createdAt: Date.now(),
      // Store just what you already stored; if you saved the whole gs, keep doing that:
      state: gs
    };
    const txt = JSON.stringify(payload);
    // write with your existing key
    localStorage.setItem('dl.save', txt);
    return true;
  } catch (err) {
    console.warn('Save failed:', err);
    return false;
  }
}


export function loadState() {
  try {
    const txt =
      localStorage.getItem('dl.save') ??
      localStorage.getItem('dl-save') ??
      localStorage.getItem('dragon.save');
    if (!txt) return false;

    const raw = JSON.parse(txt);
    const save = migrateSave(raw);
    if (!save) return false;

    const loaded = save.state;
    if (!loaded || typeof loaded !== 'object') return false;

    Object.assign(GameState, loaded);
    
    // Rehydrate cellWalls as a Map if needed
if (Array.isArray(loaded.cellWalls)) {
  GameState.cellWalls = new Map(loaded.cellWalls);
} else if (!(GameState.cellWalls instanceof Map)) {
  GameState.cellWalls = new Map();
}

    return true;
  } catch (err) {
    console.warn('Load failed:', err);
    return false;
  }
}


// ===== Convenience Reset =====
export function resetState(gs = GameState) {
  gs.wave = 1;
  gs.gold = 0;
  gs.bones = 0;
  gs.dragonHP = DRAGON_BASE.maxHP;
  gs.autoStart = false;
  gs.enemies = [];
  gs.projectiles = [];
  gs.effects = [];
  gs.upgrades = {};
  gs.cellWalls = new Map();
  gs.distFromEntry = makeScalarField(GRID.cols, GRID.rows, Infinity);
  gs.distToExit    = makeScalarField(GRID.cols, GRID.rows, Infinity);
  gs.successTrail  = makeScalarField(GRID.cols, GRID.rows, 0);
  gs.seed = 0;
}

// ===== Econ helpers =====
export function canAffordEdge(gs, place = true) {
  return place ? gs.bones >= COSTS.edgeWall : true;
}
export function spendBones(gs, amt) {
  gs.bones = Math.max(0, (gs.bones | 0) - (amt | 0));
}
export function refundBones(gs, amt) {
  gs.bones = (gs.bones | 0) + (amt | 0);
}
