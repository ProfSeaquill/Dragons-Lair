// state.js — constants, GameState factory, persistence, and derived stats (UNLIMITED UPGRADES)

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

// Campaign cap for victory gate
export const MAX_WAVES = 101;

// --- Dragon defaults ---
export const DRAGON_DEFAULTS = {
  clawCooldown: 5,   // seconds
  wingCooldown: 30,  // seconds
  hpMax: 100,        // baseline max HP
};

// --- Unlimited Upgrades: cost/effect formulas ---
// All upgrades are unlimited (no caps). Costs scale exponentially, effects scale multiplicatively
// (or stepwise where that makes more sense).
//
// Notes:
// - "speed" is BREATHS PER SECOND; higher is faster.
// - "reachTiles" is a distance unit your renderer already uses (you previously returned ladder values).
// - "wings" is knockback distance in tiles.
// - "claws" is AoE claw damage.
// - "regenPerWave" is HP restored between waves.
export const UPGRADE_CONFIG = {
  power: {                   // direct damage per breath tick
    baseCost: 50,
    costGrowth: 1.18,
    baseEffect: 10,          // roughly your first ladder value
    effectGrowth: 1.12,
  },
  speed: {                   // breaths per second (BPS)
    baseCost: 75,
    costGrowth: 1.20,
    baseEffect: 0.50,        // your old first entry
    effectGrowth: 1.07,      // 0.5 → 0.54 → 0.58 ... trending to 3.0+ with levels
  },
  reach: {                   // reach expressed in your existing "tiles" metric
    baseCost: 60,
    costGrowth: 1.16,
    baseEffect: 10,          // start near your old ladder (10)
    stepPerLevel: 4,         // +4 per level (simple, readable, unlimited)
  },
  burn: {                    // DoT DPS applied for ECON.BURN_DURATION
    baseCost: 65,
    costGrowth: 1.19,
    baseEffect: 1,           // matches ladder start
    effectGrowth: 1.15,
  },
  claws: {                   // claw AoE damage
    baseCost: 80,
    costGrowth: 1.18,
    baseEffect: 20,
    effectGrowth: 1.20,
  },
  wings: {                   // knockback distance in tiles
    baseCost: 70,
    costGrowth: 1.17,
    baseEffect: 0,
    stepPerLevel: 2,         // +2 tiles per level
  },
  regen: {                   // HP recovered between waves
    baseCost: 50,
    costGrowth: 1.15,
    baseEffect: 10,
    stepPerLevel: 2,         // +2 HP per level
  },
};

// Compute the price for the NEXT level (given current level)
export function upgradeCost(kind, level) {
  const cfg = UPGRADE_CONFIG[kind];
  if (!cfg) return Number.POSITIVE_INFINITY;
  return Math.floor(cfg.baseCost * Math.pow(cfg.costGrowth, level));
}

// Convenience for UI: price using gs.upgrades
export function nextUpgradeCost(kind, upgrades) {
  const lvl = (upgrades && upgrades[kind]) | 0;
  return upgradeCost(kind, lvl);
}

// --- Helpers: clamp & safe indexing ---
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
      hpMax: DRAGON_DEFAULTS.hpMax,
      hp: DRAGON_DEFAULTS.hpMax,
    },

    // transient FX & timers (root-level; NOT inside dragon)
    fx: { claw: [], wing: [] },
    _time: 0,
    _lastClawFx: 0,

    // end-of-wave flags (root-level)
    gameOver: false,
    _endedReason: null,     // 'victory' | 'defeat' | null
    _endedThisWave: false,  // guard to avoid double endWave()

    // upgrades (unlimited integer levels)
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
// Convert upgrade levels into concrete combat numbers.
// These should be read-only views; do not mutate gs here.
export function getDragonStats(gs) {
  const u = (gs && gs.upgrades) ? gs.upgrades : {};
  const lv = (k) => (u[k] | 0);

  // multiplicative helpers
  const powEff = (k, base, growth) => base * Math.pow(growth, lv(k));
  const stepEff = (k, base, step) => base + step * lv(k);

  const power         = Math.round(powEff('power', UPGRADE_CONFIG.power.baseEffect, UPGRADE_CONFIG.power.effectGrowth));
  const breathsPerSec = +(powEff('speed', UPGRADE_CONFIG.speed.baseEffect, UPGRADE_CONFIG.speed.effectGrowth)).toFixed(3);
  const reachTiles    = Math.round(stepEff('reach', UPGRADE_CONFIG.reach.baseEffect, UPGRADE_CONFIG.reach.stepPerLevel));
  const burnDps       = Math.round(powEff('burn', UPGRADE_CONFIG.burn.baseEffect, UPGRADE_CONFIG.burn.effectGrowth));
  const claws         = Math.round(powEff('claws', UPGRADE_CONFIG.claws.baseEffect, UPGRADE_CONFIG.claws.effectGrowth));
  const wings         = Math.round(stepEff('wings', UPGRADE_CONFIG.wings.baseEffect, UPGRADE_CONFIG.wings.stepPerLevel));
  const regenPerWave  = Math.round(stepEff('regen', UPGRADE_CONFIG.regen.baseEffect, UPGRADE_CONFIG.regen.stepPerLevel));

  return {
    power,
    reachTiles,
    breathsPerSec,
    burnDps,
    burnDuration: ECON.BURN_DURATION,
    claws,
    wings,
    regenPerWave,
    clawCooldown: DRAGON_DEFAULTS.clawCooldown,
    wingCooldown: DRAGON_DEFAULTS.wingCooldown,
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
const SAVE_KEY = 'dl_save_v2'; // bump key to avoid mixing with older ladder saves

export function save(gs) {
  try {
    const data = {
      wave: gs.wave|0,
      gold: gs.gold|0,
      bones: gs.bones|0,
      dragon: {
        hpMax: gs.dragon?.hpMax|0 ?? DRAGON_DEFAULTS.hpMax,
        hp: clamp(gs.dragon?.hp|0 ?? DRAGON_DEFAULTS.hpMax, 0, gs.dragon?.hpMax|0 ?? DRAGON_DEFAULTS.hpMax),
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
  // Try v2 first, then fall back to v1 (migrating old saves)
  let raw = localStorage.getItem(SAVE_KEY);
  const FALLBACK_KEY = 'dl_save_v1';
  if (!raw) raw = localStorage.getItem(FALLBACK_KEY);
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);

    // restore primitives
    gs.wave = clamp(data.wave|0 || 1, 1, 10_000);
    gs.gold = Math.max(0, data.gold|0 || 0);
    gs.bones = Math.max(0, data.bones|0 || 0);

    // restore dragon
    const hpMax = clamp((data.dragon?.hpMax|0) || DRAGON_DEFAULTS.hpMax, 1, 1_000_000);
    let hp = clamp((data.dragon?.hp|0) || hpMax, 0, hpMax);
    gs.dragon = { hpMax, hp };

    // restore upgrades (NO ladder clamp — unlimited now)
    const u = (data.upgrades || {});
    gs.upgrades = {
      power: Math.max(0, u.power|0 || 0),
      reach: Math.max(0, u.reach|0 || 0),
      speed: Math.max(0, u.speed|0 || 0),
      burn:  Math.max(0, u.burn|0  || 0),
      claws: Math.max(0, u.claws|0 || 0),
      wings: Math.max(0, u.wings|0 || 0),
      regen: Math.max(0, u.regen|0 || 0),
    };

    // restore walls (back into Set)
    gs.walls = new Set(Array.isArray(data.walls) ? data.walls : []);

    // reset transients after load
    gs.mode = 'build';
    gs.enemies = [];
    gs.path = [];
    gs.justStartedAt = 0;
    gs.lastWaveEndedAt = 0;

    // If we loaded from old v1, immediately re-save to v2 format
    if (!localStorage.getItem(SAVE_KEY)) {
      save(gs);
    }

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
  gs.dragon = { hpMax: DRAGON_DEFAULTS.hpMax, hp: DRAGON_DEFAULTS.hpMax };
  gs.upgrades = { power: 0, reach: 0, speed: 0, burn: 0, claws: 0, wings: 0, regen: 0 };
  gs.walls = new Set();
  gs.path = [];
  gs.enemies = [];
  gs.autoStart = false;
  gs.justStartedAt = 0;
  gs.lastWaveEndedAt = 0;
}

// --- (Optional) typed hints for other modules ---
// export type GameState = ReturnType<typeof initState>;
