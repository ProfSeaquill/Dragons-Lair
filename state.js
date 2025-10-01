// state.js — per-edge wall model + core game state + helpers

// ===== Grid & Entry/Exit =====
export const GRID = { cols: 24, rows: 16, tile: 32 };

export const ENTRY = { x: 0, y: Math.floor(GRID.rows / 2) };
export const EXIT  = { x: GRID.cols - 1, y: Math.floor(GRID.rows / 2) };

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

// Returns an array of tile coords covered by the dragon hitbox
export function dragonCells(gs) {
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
  breathPower: 50,
  breathRange: 8 * GRID.tile,
  breathWidth: GRID.tile * 0.9,
  burnDPS: 1,
  burnDuration: 1,
  fireRate: 0.5, // shots/sec
};
// ===== Ability Upgrade Levels =====
// (0 = base; you can unlock/level these however you like)
export const Upgrades = {
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

// ===== Ability Stat Getters (exported) =====
export function getClawStats(gs) {
  const lv = (gs.upgrades?.claw | 0);
  return {
    dmg:         Math.round(lin(40, 8, lv)),             // big hit
    cd:          stepDownCooldown(6.0, 2.5, lv, 3, 0.85), // every 3 lv -> -15%
    radiusCells: 1,                                       // adjacents around dragon
  };
}

export function getGustStats(gs) {
  const lv = (gs.upgrades?.gust | 0);
  return {
    pushTiles: Math.min(6, lin(2, 1, lv)),               // +1 tile per level up to 6
    cd:        stepDownCooldown(14.0, 6.0, lv, 2, 0.85),
  };
}

export function getRoarStats(gs) {
  const lv = (gs.upgrades?.roar | 0);
  const rangeTiles = state.GRID.w + state.GRID.h; // covers entire map
  return {
    stunSec:     lin(1.5, 0.25, lv),                     // longer stun per level
    cd:          stepDownCooldown(40.0, 20.0, lv, 2, 0.85),
    // fear behavior buffs (no penalty increase over time—per your request)
    senseMult:   1.4,
    herdingMult: 1.5,
    buffDur:     5.0,
  };
}

export function getStompStats(gs) {
  const lv = (gs.upgrades?.stomp | 0);
  const rangeTiles = state.GRID.w + state.GRID.h; // covers entire map
  return {
    dmg:        Math.round(lin(6, 3, lv)),               // chip damage
    slowMult:   clamp01(1.0 - (0.20 + 0.05 * lv)),       // base 20% slow +3%/lvl
    slowSec:    3.0,
    cd:         stepDownCooldown(18.0, 8.0, lv, 2, 0.85),
  };
}

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
export function inBounds(x, y) {
  return x >= 0 && x < GRID.cols && y >= 0 && y < GRID.rows;
}

// ===== Game State (single mutable object) =====
export const GameState = {
  version: 2,
  wave: 1,
  gold: 0,
  bones: 0,
  dragonHP: DRAGON_BASE.maxHP,
  autoStart: false,

  // Visual-only dragon breath (mouth burst / sprite timing)
  dragonFX: { attacking: false, t: 0, dur: 0.5 },

  // Simulation containers
  enemies: [],
  projectiles: [],
  effects: [],

    // Ability upgrades + UI requests (set by HUD buttons)
  Upgrades: { ...Upgrades },   // levels
  reqWingGust: false,
  reqRoar:     false,
  reqStomp:    false,

  // Upgrades
  upgrades: {},

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
export function ensureCell(gs, x, y) {
  const k = tileKey(x, y);
  let rec = gs.cellWalls.get(k);
  if (!rec) { rec = { N: false, E: false, S: false, W: false }; gs.cellWalls.set(k, rec); }
  return rec;
}

export function isOpen(gs, x, y, side) {
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
  const out = [];
  if (isOpen(gs, cx, cy, 'N')) out.push({ x: cx,     y: cy - 1, side: 'N' });
  if (isOpen(gs, cx, cy, 'E')) out.push({ x: cx + 1, y: cy,     side: 'E' });
  if (isOpen(gs, cx, cy, 'S')) out.push({ x: cx,     y: cy + 1, side: 'S' });
  if (isOpen(gs, cx, cy, 'W')) out.push({ x: cx - 1, y: cy,     side: 'W' });
  return out;
}

export function setEdgeWall(gs, x, y, side, hasWall) {
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

// ===== Dragon Stats with upgrades applied =====
export function getDragonStats(gs) {
  const u = gs?.upgrades || {};
  const powMult   = 1 + 0.15 * (u.power || 0);
  const rateMult  = 1 + 0.10 * (u.rate  || 0);
  const rangeMult = 1 + 0.05 * (u.range || 0);
  const burnMult  = 1 + 0.15 * (u.burn  || 0);

  return {
    maxHP: DRAGON_BASE.maxHP + 10 * (u.hp || 0),
    breathPower: DRAGON_BASE.breathPower * powMult,
    breathRange: DRAGON_BASE.breathRange * rangeMult,
    breathWidth: DRAGON_BASE.breathWidth,
    burnDPS: DRAGON_BASE.burnDPS * burnMult,
    burnDuration: DRAGON_BASE.burnDuration + 0.5 * (u.burn || 0),
    fireRate: DRAGON_BASE.fireRate * rateMult,
  };
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
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('saveState failed:', e);
    return false;
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);

    GameState.wave      = data.wave ?? GameState.wave;
    GameState.gold      = data.gold ?? GameState.gold;
    GameState.bones     = data.bones ?? GameState.bones;
    GameState.dragonHP  = data.dragonHP ?? GameState.dragonHP;
    GameState.autoStart = data.autoStart ?? GameState.autoStart;
    GameState.upgrades  = data.upgrades ?? {};
    GameState.seed      = data.seed ?? 0;

    GameState.cellWalls = new Map();
    if (Array.isArray(data.cellWalls)) {
      for (const [k, v] of data.cellWalls) {
        const rec = { N: !!v?.N, E: !!v?.E, S: !!v?.S, W: !!v?.W };
        GameState.cellWalls.set(k, rec);
      }
    } else if (Array.isArray(data.walls)) {
      // legacy
      for (const k of data.walls) {
        const [sx, sy] = k.split(',');
        const x = +sx, y = +sy;
        if (!inBounds(x, y)) continue;
        setEdgeWall(GameState, x, y, 'N', true);
        setEdgeWall(GameState, x, y, 'E', true);
        setEdgeWall(GameState, x, y, 'S', true);
        setEdgeWall(GameState, x, y, 'W', true);
      }
    }

    // Fresh fields (recomputed properly by pathing on boot/toggle)
    GameState.distFromEntry = makeScalarField(GRID.cols, GRID.rows, Infinity);
    GameState.distToExit    = makeScalarField(GRID.cols, GRID.rows, Infinity);
    GameState.successTrail  = makeScalarField(GRID.cols, GRID.rows, 0);

    return true;
  } catch (e) {
    console.warn('loadState failed:', e);
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
