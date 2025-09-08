// state.js — constants, GameState factory, persistence, and derived stats

// --- Grid & economy constants ---
export const GRID = {
  W: 24,            // columns
  H: 16,            // rows
  TILE: 32,         // px per tile; 24*32 = 768, 16*32 = 512 (matches index.html canvas)
};

export const ECON = {
  WALL_COST: 10,
  WALL_REFUND: 5,
  BURN_DURATION: 3.0, // seconds DoT lasts
};

// --- Upgrade ladders (indexes 0..n) ---
// Power [5,8,12,18,26,38,55]; Reach [5..12]; Speed [1.0..3.0]; Burn [1..12]
export const LADDERS = {
  power: [10, 14, 18, 24, 38, 46, 55, 70],
  reach: [10, 14, 18, 24, 32, 40, 50, 60, 75, 90, 120],           // tiles (radius in tiles)
  speed: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2.0, 2.2, 2.4, 2.7, 3.0], // breaths per second
  burn:  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],    // DPS applied for ECON.BURN_DURATION
  claws: [20, 30, 50, 70, 90, 120, 150],   // damage dealt to adjacent enemies
  wings: [0, 1, 3, 5, 7, 9, 12, 15],              // tiles knocked back by wing gust
  regen: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40], // HP recovered between waves
};

export const DRAGON_DEFAULTS = {
  clawCooldown: 5,  // seconds
  wingCooldown: 30,  // seconds
};

// --- Helpers: clamp & safe indexing ---
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function ladderPick(arr, idx, fallback) {
  if (!Array.isArray(arr)) return fallback;
  const i = clamp(idx|0, 0, arr.length - 1);
  return arr[i] ?? fallback;
}

// --- GameState factory ---
// Note: Keep everything serializable; Sets are stringified to arrays on save.
export function initState() {
  /** @type {import('./types').GameState|any} */
  const gs = {
    // flow
    mode: 'build',           // 'build' | 'combat'
    wave: 1,

    // currencies
    gold: 0,
    bones: 0,

    // dragon
    dragon: {
  hpMax: 100,
  hp: 100,
},

// transient FX & timers (root-level; NOT inside dragon)
fx: { claw: [], wing: [] },
_time: 0,
_lastClawFx: 0,

// end-of-wave flags (root-level)
gameOver: false,
_endedReason: null,     // 'victory' | 'defeat' | null
_endedThisWave: false,  // guard to avoid double endWave()

    // upgrades (indexes into ladders)
    upgrades: {
      power: 0,
      reach: 0,
      speed: 0,
      burn: 0,
      claws: 0,
      wings: 0,
      regen: 0,
    },

    // map/building
    walls: new Set(),        // Set<"x,y"> of wall tiles
    path: [],                // computed by pathing.recomputePath(gs)

    // runtime
    enemies: [],             // active enemies (combat.js owns the shape)
    autoStart: false,        // toggled by UI
    justStartedAt: 0,        // timestamps for debounce (main.js)
    lastWaveEndedAt: 0,

    // hooks for modules to attach misc state (non-persistent)
    // e.g., gs.fx = {}; gs.stats = {};
  };

  return gs;
}

// --- Derived stats from upgrades ---
// Convert upgrade indexes into concrete combat numbers.
// These should be read-only views; do not mutate gs here.
export function getDragonStats(gs) {
  const u = (gs && gs.upgrades) ? gs.upgrades : {};
  const pick = (arr, idx, fb) => ladderPick(arr, (idx|0) || 0, fb);
  return {
    power:          pick(LADDERS.power,  u.power, 5),
    reachTiles:     pick(LADDERS.reach,  u.reach, 5),
    breathsPerSec:  pick(LADDERS.speed,  u.speed, 1.0),
    burnDps:        pick(LADDERS.burn,   u.burn,  1),
    burnDuration:   ECON.BURN_DURATION,
    claws:          pick(LADDERS.claws,  u.claws, 0),
    wings:          pick(LADDERS.wings,  u.wings, 0),
    regenPerWave:   pick(LADDERS.regen,  u.regen, 10),
  };
}

// --- Currency helpers (optional; safe no-ops on negatives) ---
export function addGold(gs, amount) {
  gs.gold = Math.max(0, (gs.gold|0) + (amount|0));
}
export function addBones(gs, amount) {
  gs.bones = Math.max(0, (gs.bones|0) + (amount|0));
}

// --- Wall helpers ---
// Consumed by pathing.js typically, but provided here for convenience.
export function hasWall(gs, x, y) {
  return gs.walls.has(key(x, y));
}
export function placeWall(gs, x, y) {
  gs.walls.add(key(x, y));
}
export function removeWall(gs, x, y) {
  gs.walls.delete(key(x, y));
}
function key(x, y) { return `${x},${y}`; }

// --- Persistence (localStorage) ---
const SAVE_KEY = 'dl_save_v1';

export function save(gs) {
  try {
    const data = {
      wave: gs.wave|0,
      gold: gs.gold|0,
      bones: gs.bones|0,
      dragon: {
        hpMax: gs.dragon?.hpMax|0 ?? 100,
        hp: clamp(gs.dragon?.hp|0 ?? 100, 0, gs.dragon?.hpMax|0 ?? 100),
      },
      upgrades: {
  power: gs.upgrades?.power|0 ?? 0,
  reach: gs.upgrades?.reach|0 ?? 0,
  speed: gs.upgrades?.speed|0 ?? 0,
  burn:  gs.upgrades?.burn|0  ?? 0,
  claws: gs.upgrades?.claws|0 ?? 0,
  wings: gs.upgrades?.wings|0 ?? 0,
  regen: gs.upgrades?.regen|0 ?? 0,
},
      walls: Array.from(gs.walls ?? []).slice(0, 5000), // cap to keep saves small
      // Note: We DO NOT save transient fields: mode, enemies, path, timers.
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('[DL] save failed', e);
    return false;
  }
}

export function load(gs) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);

    // restore primitives
    gs.wave = clamp(data.wave|0 || 1, 1, 10_000);
    gs.gold = Math.max(0, data.gold|0 || 0);
    gs.bones = Math.max(0, data.bones|0 || 0);

    // restore dragon
    const hpMax = clamp(data.dragon?.hpMax|0 || 100, 1, 1_000_000);
    let hp = clamp(data.dragon?.hp|0 || hpMax, 0, hpMax);
    gs.dragon = { hpMax, hp };

    // restore upgrades (clamped to ladder length - 1)
    const ladd = LADDERS;
    gs.upgrades = {
  power: clamp(data.upgrades?.power|0 || 0, 0, ladd.power.length - 1),
  reach: clamp(data.upgrades?.reach|0 || 0, 0, ladd.reach.length - 1),
  speed: clamp(data.upgrades?.speed|0 || 0, 0, ladd.speed.length - 1),
  burn:  clamp(data.upgrades?.burn|0  || 0, 0, ladd.burn.length  - 1),
  claws: clamp(data.upgrades?.claws|0 || 0, 0, (ladd.claws||[]).length - 1),
  wings: clamp(data.upgrades?.wings|0 || 0, 0, (ladd.wings||[]).length - 1),
  regen: clamp(data.upgrades?.regen|0 || 0, 0, (ladd.regen||[]).length - 1),
};

    // restore walls (back into Set)
    gs.walls = new Set(Array.isArray(data.walls) ? data.walls : []);

    // reset transients after load
    gs.mode = 'build';
    gs.enemies = [];
    gs.path = [];
    gs.justStartedAt = 0;
    gs.lastWaveEndedAt = 0;

    return true;
  } catch (e) {
    console.warn('[DL] load failed', e);
    return false;
  }
}

// --- Utilities ---
export function resetProgress(gs) {
  // Hard reset while keeping the same object reference (less churn for imports)
  gs.mode = 'build';
  gs.wave = 1;
  gs.gold = 0;
  gs.bones = 0;
  gs.dragon = { hpMax: 100, hp: 100 };
  gs.upgrades = { power: 0, reach: 0, speed: 0, burn: 0, claws: 0, wings: 0, regen: 0 };
  gs.walls = new Set();
  gs.path = [];
  gs.enemies = [];
  gs.autoStart = false;
  gs.justStartedAt = 0;
  gs.lastWaveEndedAt = 0;
}

// --- (Optional) typed hints for other modules ---
// If you keep a shared d.ts-like file, you can define a lightweight shape:
// export type GameState = ReturnType<typeof initState>;
