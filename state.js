// state.js — constants, GameState factory, persistence, and derived stats (UNLIMITED UPGRADES, BONES HEAL)

// --- Grid & economy constants ---
export const GRID = {
  W: 24,
  H: 16,
  TILE: 32,
};

export const ECON = {
  WALL_COST: 10,
  WALL_REFUND: 5,
  BURN_DURATION: 3.0, // seconds DoT lasts
  HEAL_PER_BONE: 1,   // << 1 HP per bone
};

// Campaign cap for victory gate
export const MAX_WAVES = 101;

// --- Dragon defaults ---
export const DRAGON_DEFAULTS = {
  clawCooldown: 5,
  wingCooldown: 30,
  hpMax: 100,
};

// --- Unlimited Upgrades: cost/effect formulas ---
export const UPGRADE_CONFIG = {
  power: {  baseCost: 20, costGrowth: 1.20, baseEffect: 12,  effectGrowth: 1.4 },
  speed: {  baseCost: 25, costGrowth: 1.20, baseEffect: 0.7, effectGrowth: 1.1 }, // breaths/sec
  reach: {  baseCost: 35, costGrowth: 1.20, baseEffect: 10,  stepPerLevel: 3 },    // tiles
  burn:  {  baseCost: 25, costGrowth: 1.2, baseEffect: 1,   effectGrowth: 1.15 },
  claws: {  baseCost: 20, costGrowth: 1.5, baseEffect: 30,  effectGrowth: 1.20 },
  wings: {  baseCost: 40, costGrowth: 1.5, baseEffect: 1,   stepPerLevel: 2 },
  // NOTE: regen removed
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

// --- Helpers ---
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// --- GameState factory ---
export function initState() {
  const gs = {
    mode: 'build',
    wave: 1,

    gold: 0,
    bones: 0,

    dragon: {
      hpMax: DRAGON_DEFAULTS.hpMax,
      hp: DRAGON_DEFAULTS.hpMax,
    },

    fx: { claw: [], wing: [] },
    _time: 0,
    _lastClawFx: 0,

    gameOver: false,
    _endedReason: null,
    _endedThisWave: false,

    upgrades: {
      power: 0,
      reach: 0,
      speed: 0,
      burn: 0,
      claws: 0,
      wings: 0,
      // regen removed
    },

    walls: new Set(),
    path: [],

    enemies: [],
    autoStart: false,
    justStartedAt: 0,
    lastWaveEndedAt: 0,
  };
  return gs;
}

// --- Derived stats from upgrades ---
export function getDragonStats(gs) {
  const u = (gs && gs.upgrades) ? gs.upgrades : {};
  const lv = (k) => (u[k] | 0);

  const powEff  = (k, base, growth) => base * Math.pow(growth, lv(k));
  const stepEff = (k, base, step)   => base + step * lv(k);

  const power         = Math.round(powEff('power', UPGRADE_CONFIG.power.baseEffect, UPGRADE_CONFIG.power.effectGrowth));
  const breathsPerSec = +(powEff('speed', UPGRADE_CONFIG.speed.baseEffect, UPGRADE_CONFIG.speed.effectGrowth)).toFixed(3);
  const reachTiles    = Math.round(stepEff('reach', UPGRADE_CONFIG.reach.baseEffect, UPGRADE_CONFIG.reach.stepPerLevel));
  const burnDps       = Math.round(powEff('burn',  UPGRADE_CONFIG.burn.baseEffect,  UPGRADE_CONFIG.burn.effectGrowth));
  const claws         = Math.round(powEff('claws', UPGRADE_CONFIG.claws.baseEffect, UPGRADE_CONFIG.claws.effectGrowth));
  const wings         = Math.round(stepEff('wings', UPGRADE_CONFIG.wings.baseEffect, UPGRADE_CONFIG.wings.stepPerLevel));

  return {
    power,
    reachTiles,
    breathsPerSec,
    burnDps,
    burnDuration: ECON.BURN_DURATION,
    claws,
    wings,
    // regen removed
    clawCooldown: DRAGON_DEFAULTS.clawCooldown,
    wingCooldown: DRAGON_DEFAULTS.wingCooldown,
  };
}

// --- Healing with bones ---
export function healWithBones(gs, maxBones = Infinity) {
  if (!gs?.dragon) return 0;
  const need = Math.max(0, gs.dragon.hpMax - gs.dragon.hp);
  if (need <= 0) return 0;
  const availableBones = gs.bones | 0;
  const per = ECON.HEAL_PER_BONE | 0 || 1;
  const maxByBones = Math.floor(availableBones * per);
  const heal = Math.min(need, maxByBones, maxBones|0 === Infinity ? need : (maxBones|0));
  if (heal <= 0) return 0;

  // consume bones first
  const bonesToSpend = Math.ceil(heal / per);
  gs.bones = Math.max(0, availableBones - bonesToSpend);
  gs.dragon.hp = Math.min(gs.dragon.hpMax, gs.dragon.hp + heal);
  return heal;
}

// --- Currency helpers ---
export function addGold(gs, amount) {
  gs.gold = Math.max(0, (gs.gold|0) + (amount|0));
}
export function addBones(gs, amount) {
  gs.bones = Math.max(0, (gs.bones|0) + (amount|0));
}

// --- Wall helpers ---
export function hasWall(gs, x, y) { return gs.walls.has(key(x, y)); }
export function placeWall(gs, x, y) { gs.walls.add(key(x, y)); }
export function removeWall(gs, x, y) { gs.walls.delete(key(x, y)); }
function key(x, y) { return `${x},${y}`; }

// --- Persistence (localStorage) ---
const SAVE_KEY = 'dl_save_v2b'; // bump because regen removed

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
      },
      walls: Array.from(gs.walls ?? []).slice(0, 5000),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('[DL] save failed', e);
    return false;
  }
}

export function load(gs) {
  // Load latest; if missing, try older keys and migrate
  const KEYS = ['dl_save_v2b', 'dl_save_v2', 'dl_save_v1'];
  let raw = null, keyUsed = null;
  for (const k of KEYS) { raw = localStorage.getItem(k); if (raw) { keyUsed = k; break; } }
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);

    gs.wave = clamp(data.wave|0 || 1, 1, 10_000);
    gs.gold = Math.max(0, data.gold|0 || 0);
    gs.bones = Math.max(0, data.bones|0 || 0);

    const hpMax = clamp((data.dragon?.hpMax|0) || DRAGON_DEFAULTS.hpMax, 1, 1_000_000);
    let hp = clamp((data.dragon?.hp|0) || hpMax, 0, hpMax);
    gs.dragon = { hpMax, hp };

    // Upgrades: drop any legacy regen
    const u = (data.upgrades || {});
    gs.upgrades = {
      power: Math.max(0, u.power|0 || 0),
      reach: Math.max(0, u.reach|0 || 0),
      speed: Math.max(0, u.speed|0 || 0),
      burn:  Math.max(0, u.burn|0  || 0),
      claws: Math.max(0, u.claws|0 || 0),
      wings: Math.max(0, u.wings|0 || 0),
    };

    gs.walls = new Set(Array.isArray(data.walls) ? data.walls : []);

    gs.mode = 'build';
    gs.enemies = [];
    gs.path = [];
    gs.justStartedAt = 0;
    gs.lastWaveEndedAt = 0;

    // Re-save into new key if we loaded old format
    if (keyUsed !== SAVE_KEY) save(gs);

    return true;
  } catch (e) {
    console.warn('[DL] load failed', e);
    return false;
  }
}

// --- Utilities ---
export function resetProgress(gs) {
  gs.mode = 'build';
  gs.wave = 1;
  gs.gold = 0;
  gs.bones = 0;
  gs.dragon = { hpMax: DRAGON_DEFAULTS.hpMax, hp: DRAGON_DEFAULTS.hpMax };
  gs.upgrades = { power: 0, reach: 0, speed: 0, burn: 0, claws: 0, wings: 0 };
  gs.walls = new Set();
  gs.path = [];
  gs.enemies = [];
  gs.autoStart = false;
  gs.justStartedAt = 0;
  gs.lastWaveEndedAt = 0;
}
