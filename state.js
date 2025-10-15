// state.js — per-edge wall model + core game state + helpers

// ---- Config defaults (safe, minimal, matches your current game) ----
export const DEFAULT_CFG = {
  tuning: {
    abilities: { gust: 15, roar: 20, stomp: 20 },   // keep your current timers
    dragon:   { maxHP: 100, healCostBone: 1 },      // 1 bone per HP
    boss:     { hpMultiplier: 10, armor: 0 },       // as-used in your scaling
    economy:  { wallCostBones: 1, goldBase: 5 },     // WALLS: 1 bone by default

  waves: {
     count: { base: 5, cap: 200, k: 0.001 },
     mixCurves: { villager: { minWave: 1, base: 1, cap: 1, k: 0 } },
     mixOptions: { floor: 0.0, ceil: 1.0, unlockFill: 'renorm' },
     cadence: { bossEvery: 10, kingsguardEvery: 5 }
   }
},
  
  enemies: {},     // no assumptions; fill via enemies.json
  waves: null,     // not used; real tuning lives in tuning.waves
  upgrades: {}     // runtime levels
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

// ===== Grid & Entry/Exit =====
export const GRID = { cols: 24, rows: 16, tile: 32 };

export const ENTRY = { x: 0, y: Math.floor(GRID.rows / 2) };
export const EXIT  = { x: GRID.cols - 1, y: Math.floor(GRID.rows / 2) };

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


// ===== Base Dragon Stats =====
const DRAGON_BASE = {
  maxHP: 100,
  breathPower: 10,
  breathRange: 8 * GRID.tile,
  breathWidth: GRID.tile * 0.9,
  burnDPS: 1,
  burnDuration: 1,
  fireRate: 0.5, // shots/sec
};

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


// ===== Phase 6: tuned wrappers (non-breaking) =====

function _cfg(gs) { return (getCfg?.(gs) ?? {}).tuning ?? {}; }
function _lvl(gs, keyPrefix) {
  // Count how many upgrades matching a prefix were bought (e.g., "claw_dmg_")
  const U = (gs && gs.upgrades) || {};
  let n = 0;
  for (const k in U) if (U[k] && k.startsWith(keyPrefix)) n += (U[k] | 0);
  return n | 0;
}

// keep your base helper (or add if you don't have it yet)
function getDragonStatsBase() {
  // Matches DRAGON_BASE; adjust if you changed it
  return {
    maxHP: 100, breathPower: 10, breathRange: 8 * GRID.tile,
    breathWidth: GRID.tile * 0.9, burnDPS: 1, burnDuration: 1, fireRate: 0.5
  };
}

export function getDragonStatsTuned(gs) {
  const base = getDragonStatsBase();
  const T = flameTune(gs);

  const lvPower = (gs?.upgrades?.power | 0) || 0;
  const lvRate  = (gs?.upgrades?.rate  | 0) || 0;
  const lvRange = (gs?.upgrades?.range | 0) || 0;
  const lvBurn  = (gs?.upgrades?.burn  | 0) || 0;

  const basePower = (typeof T.baseDamage     === 'number') ? T.baseDamage     : base.breathPower;
  const baseRate  = (typeof T.fireRate       === 'number') ? T.fireRate       : base.fireRate;
  const baseTiles = (typeof T.baseRangeTiles === 'number') ? T.baseRangeTiles : (base.breathRange / GRID.tile);
  const baseBurn  = (typeof T.burnDps        === 'number') ? T.burnDps        : base.burnDPS;
  const baseBurnS = (typeof T.burnDuration   === 'number') ? T.burnDuration   : base.burnDuration;

  const breathPower = approachCap(basePower, T.capDamage,      lvPower, T.kDamage);
  const fireRate    = approachCap(baseRate,  T.capRate,        lvRate,  T.kRate);
  const tiles       = approachCap(baseTiles, T.capRangeTiles,  lvRange, T.kRange);
  const burnDPS     = approachCap(baseBurn,  T.capBurnDps,     lvBurn,  T.kBurnDps);
  const burnDuration= approachCap(baseBurnS, T.capBurnDuration,lvBurn,  T.kBurnDuration);

  return {
    ...base,
    breathPower: Math.max(0, breathPower),
    fireRate:    Math.max(0.01, fireRate),
    breathRange: Math.max(1, tiles) * GRID.tile,
    burnDPS:     Math.max(0, burnDPS),
    burnDuration:Math.max(0, burnDuration),
  };
}


// CLaw: damage ↑ to capDmg, cooldown ↓ to minCd
export function getClawStatsTuned(gs) {
  const lv = abilityLvl(gs, 'claw');
  const base = { dmg: 100, cd: 10.0 };
  const t = getCfg(gs)?.tuning?.claw || {};
  const capDmg = t.capDamage ?? 500;
  const kDmg   = t.kDamage  ?? 0.25;

  const baseCd = t.baseCooldownSec ?? base.cd;
  const minCd  = t.minCooldownSec  ?? 1.0;
  const kCd    = t.kCooldown       ?? 0.25;

  return {
    dmg: Math.round(approachCap(base.dmg, capDmg, lv, kDmg)),
    cd:  approachMin(baseCd,  minCd,  lv, kCd),
  };
}

// Local read helpers (avoid importing upgrades.js)
function abilityLvl(gs, key) {
  return Math.max(0, (gs?.upgrades?.[key] | 0));
}
function statLvl(gs, key) {           // if you also reference statLvl here
  return Math.max(0, (gs?.upgrades?.[key] | 0));
}

export function getGustStatsTuned(gs) {
  const lv = abilityLvl(gs, 'gust');
  const base = { pushTiles: 2, cd: 30.0 };
  const t = getCfg(gs)?.tuning?.gust || {};
  const capPush = t.capPushTiles ?? 6;
  const kPush   = t.kPush       ?? 0.35;

  const baseCd = t.baseCooldownSec ?? base.cd;
  const minCd  = t.minCooldownSec  ?? 5.0;
  const kCd    = t.kCooldown       ?? 0.30;

  return {
    pushTiles: Math.round(approachCap(base.pushTiles, capPush, lv, kPush)),
    cd:        approachMin(baseCd, minCd, lv, kCd)
  };
}

export function getRoarStatsTuned(gs) {
  const lv = abilityLvl(gs, 'roar');
  const base = { stunSec: 1.5, cd: 60.0, buffDur: 5, senseMult: 1.4, herdingMult: 1.5, rangeTiles: (state.GRID.cols + state.GRID.rows) };
  const t = getCfg(gs)?.tuning?.roar || {};
  const capStun = t.capStunSec ?? 5.0;
  const kStun   = t.kStun      ?? 0.25;

  const baseCd = t.baseCooldownSec ?? base.cd;
  const minCd  = t.minCooldownSec  ?? 15.0;
  const kCd    = t.kCooldown       ?? 0.25;

  return {
    ...base,
    stunSec: approachCap(base.stunSec, capStun, lv, kStun),
    cd:      approachMin(baseCd, minCd, lv, kCd),
  };
}

export function getStompStatsTuned(gs) {
  const lv = abilityLvl(gs, 'stomp');
  const base = { slowMult: 0.80, slowSec: 3.0, dmg: 20, cd: 30.0, rangeTiles: (state.GRID.cols + state.GRID.rows) };
  const t = getCfg(gs)?.tuning?.stomp || {};
  // slowMult is a multiplier applied to speed (lower is stronger)
  const floorSlowMult = t.floorSlowMult ?? 0.30; // i.e., 70% slow max
  const kSlow         = t.kSlow         ?? 0.30;

  const capDmg = t.capDamage ?? 100;
  const kDmg   = t.kDamage   ?? 0.25;

  const baseCd = t.baseCooldownSec ?? base.cd;
  const minCd  = t.minCooldownSec  ?? 10.0;
  const kCd    = t.kCooldown       ?? 0.30;

  return {
    rangeTiles: base.rangeTiles,
    slowMult:   approachMin(base.slowMult, floorSlowMult, lv, kSlow),
    slowSec:    base.slowSec,
    dmg:        Math.round(approachCap(base.dmg, capDmg, lv, kDmg)),
    cd:         approachMin(baseCd, minCd, lv, kCd),
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
  if (Array.isArray(edges)) {
    for (let i = 0; i < edges.length; i++) {
      const [x, y, side] = edges[i];
      setEdgeWall(gs, x|0, y|0, side, true);
    }
  }
  gs.topologyVersion = (gs.topologyVersion || 0) + 1;
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
   const cellWallsArr = Array.from(gs.cellWalls.entries());
  const data = {
    version: gs.version,
    wave: gs.wave,
    gold: gs.gold,
    bones: gs.bones,
    dragonHP: gs.dragonHP,
    autoStart: gs.autoStart,
    upgrades: gs.upgrades,
    seed: gs.seed,
    cellWalls: cellWallsArr,
  };
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
