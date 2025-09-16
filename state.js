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

  // Upgrades
  upgrades: {},

  // Per-cell edge walls: Map<"x,y", {N,E,S,W:boolean}>
  cellWalls: new Map(),

  // Fields used by pathing/AI
  distFromEntry: makeScalarField(GRID.cols, GRID.rows, Infinity),
  distToExit:    makeScalarField(GRID.cols, GRID.rows, Infinity),
  successField:  makeScalarField(GRID.cols, GRID.rows, 0),

  // RNG / misc
  seed: 0,
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
    GameState.successField  = makeScalarField(GRID.cols, GRID.rows, 0);

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
  gs.successField  = makeScalarField(GRID.cols, GRID.rows, 0);
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
