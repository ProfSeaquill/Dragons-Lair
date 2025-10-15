// upgrades.js — fire stat upgrades + ability upgrades (Claw/Gust/Roar/Stomp)

import { GameState, getDragonStatsTuned, GRID } from './state.js';
import { getCfg } from './state.js';


// ---- Asymptotic curves (like waves) ----
function approachCap(base, cap, level, k) {
  // rises from base toward cap; k controls tempo
  return cap - (cap - base) * Math.exp(-Math.max(0, k) * Math.max(0, level|0));
}
function approachMin(base, min, level, k) {
  // drops from base toward min; k controls tempo
  return min + (base - min) * Math.exp(-Math.max(0, k) * Math.max(0, level|0));
}

// Asymptotic cost: cheap early, explodes near the cap.
// progress = how close current value is to the cap (0..~1)
function asymptoticCost({ baseCost, progress, p = 1.5, floor = 1, bumpPerLevel = 0.0, level = 0 }) {
  const denom = Math.max(0.05, 1 - Math.min(0.999, progress)); // 1→∞ near the cap
  const nearCapMult = Math.pow(1 / denom, Math.max(0.5, p));
  const linearBump = 1 + Math.max(0, bumpPerLevel) * Math.max(0, level|0);
  return Math.max(floor|0, Math.round(baseCost * nearCapMult * linearBump));
}

function flameTune(gs) {
  const t = getCfg(gs)?.tuning?.flame || {};
  return {
    // BASES (fallback to DRAGON_BASE via getDragonStatsBase call below)
    baseDamage:       t.baseDamage,              // number
    fireRate:         t.fireRate,                // shots/s
    baseRangeTiles:   t.baseRangeTiles,          // tiles
    burnDps:          t.burnDps,
    burnDuration:     t.burnDuration,

    // CAPS (where asymptotes land)
    capDamage:        t.capDamage ?? 220,
    capRate:          t.capRate   ?? 3.0,
    capRangeTiles:    t.capRangeTiles ?? 22,
    capBurnDps:       t.capBurnDps ?? 12,
    capBurnDuration:  t.capBurnDuration ?? 4,

    // TEMPOS (how fast levels approach cap)
    kDamage:          t.kDamage ?? 0.22,
    kRate:            t.kRate   ?? 0.18,
    kRange:           t.kRange  ?? 0.12,
    kBurnDps:         t.kBurnDps ?? 0.20,
    kBurnDuration:    t.kBurnDuration ?? 0.10,

    // COST curve knobs
    costBasePower:    t.costBasePower ?? 20,
    costBaseRate:     t.costBaseRate  ?? 25,
    costBaseRange:    t.costBaseRange ?? 30,
    costBaseBurn:     t.costBaseBurn  ?? 22,
    costP:            t.costP ?? 1.5,
    costBumpPerLevel: t.costBumpPerLevel ?? 0.05,
  };
}

/* ============================================================
 * Cost model (unchanged for stats; also used for abilities)
 * ========================================================== */

/** Cost function for going from level L -> L+1 */
function statCostFor(gs, key, level) {
  const T = flameTune(gs);
  const base = getDragonStatsBase();

  const shapes = {
    power: {
      base: (typeof T.baseDamage     === 'number') ? T.baseDamage     : base.breathPower,
      cap:  T.capDamage,   k: T.kDamage,   baseCost: T.costBasePower
    },
    rate:  {
      base: (typeof T.fireRate       === 'number') ? T.fireRate       : base.fireRate,
      cap:  T.capRate,     k: T.kRate,     baseCost: T.costBaseRate
    },
    range: {
      base: (typeof T.baseRangeTiles === 'number') ? T.baseRangeTiles : (base.breathRange / GRID.tile),
      cap:  T.capRangeTiles, k: T.kRange, baseCost: T.costBaseRange
    },
    burn:  {
      base: (typeof T.burnDps        === 'number') ? T.burnDps        : base.burnDPS,
      cap:  T.capBurnDps,  k: T.kBurnDps, baseCost: T.costBaseBurn
    },
  };

  const s = shapes[key];
  if (!s) return 999999; // unknown stat key

  const vNow = approachCap(s.base, s.cap, level,     s.k);
  const vNext= approachCap(s.base, s.cap, level + 1, s.k);
  const progress = (vNow - s.base) / Math.max(1e-6, (s.cap - s.base)); // 0..~1
  // Optionally factor marginal gain (small near cap) if you like:
  // const marginal = Math.max(1e-6, vNext - vNow);

  return asymptoticCost({
    baseCost: s.baseCost,
    progress,
    p: T.costP,
    bumpPerLevel: T.costBumpPerLevel,
    level
  });
}


/** Safe getters for current levels in both stores */
function statLvl(gs, key) {
  return Math.max(0, (gs.upgrades?.[key] | 0));
}
function abilityLvl(gs, key) {
  return Math.max(0, (gs.upgrades?.[key] | 0));
}

// ---- helper to build the live rows the UI expects
function buildUpgradeRows(gs) {
  const statLive    = buildFireDesc(gs);
  const abilityLive = buildAbilityDesc(gs);

  const statRows = STAT_UPGRADES.map(def => {
  const level = statLvl(gs, def.key);
  return {
    key: def.key,
    title: def.title,
    level,
    cost: statCostFor(gs, def.key, level),   // <— asymptotic
    desc: statLive[def.key] || '',
    max: undefined,
    isMax: false,
    type: def.type,
  };
});


  const abilityRows = ABILITY_UPGRADES.map(def => {
    const level = abilityLvl(gs, def.key);
    return {
      key: def.key,
      title: def.title,
      level,
      cost: costFor(def, level),
      desc: abilityLive[def.key] || '',
      max: undefined,
      isMax: false,
      type: def.type, // 'ability'
    };
  });

  return [...statRows, ...abilityRows];
}

export function listUpgrades(gs) {
  // If config supplies overrides, prefer them; otherwise build from our defs.
  const fromCfg = getCfg(gs)?.upgrades;
  const hasCfg = fromCfg && (
    (Array.isArray(fromCfg) && fromCfg.length > 0) ||
    (!Array.isArray(fromCfg) && Object.keys(fromCfg).length > 0)
  );

  if (hasCfg) {
    // UI accepts an array; if it’s an object map, normalize to array.
    return Array.isArray(fromCfg) ? fromCfg.slice() : Object.values(fromCfg);
  }

  return buildUpgradeRows(gs);
}

// Back-compat: if called with (gs) return all rows; if called with (key, gs) return one row
export function getUpgradeInfo(a = GameState, maybeGs) {
  if (typeof a === 'string') {
    const gs = maybeGs || GameState;
    return buildUpgradeRows(gs).find(r => r.key === a) || null;
  } else {
    const gs = a || GameState;
    return buildUpgradeRows(gs);
  }
}


/* ============================================================
 * Part A: FIRE STAT UPGRADES (your original ones)
 * ========================================================== */

export const STAT_UPGRADES = [
  { key: 'power', title: 'Fire Power',  base: 20, mult: 1.6, type: 'stat' },
  { key: 'rate',  title: 'Fire Rate',   base: 25, mult: 1.4, type: 'stat' },
  { key: 'range', title: 'Flame Range', base: 30, mult: 1.30, type: 'stat' },
  { key: 'burn',  title: 'Burn DoT',    base: 22, mult: 1.5, type: 'stat' },
];

/** Build live description strings for the stat upgrades using current dragon stats */
function buildFireDesc(gs) {
  const ds = getDragonStatsTuned(gs);
  const power   = Math.round(ds.breathPower);
  const rate    = ds.fireRate.toFixed(2); // shots/sec
  const pxRange = Math.round(ds.breathRange);
  const tiles   = (ds.breathRange / GRID.tile).toFixed(1);
  const burnDps = ds.burnDPS.toFixed(1);
  const burnDur = ds.burnDuration.toFixed(1);

  return {
    power: `Damage: ${power}`,
    rate:  `Rate: ${rate} /s`,
    range: `Reach: ${tiles} tiles`,
    burn:  `Burn: ${burnDps} DPS for ${burnDur}s`,
  };
}

/* ============================================================
 * Part B: ABILITY “UPGRADES” (levels affect ability stats)
 * - Claw: damage (CD steps down every 3 levels)
 * - Wing Gust: push tiles (CD steps down every 2 levels)
 * - Roar: stun time (CD steps down every 2 levels; no penalty increase)
 * - Stomp: slow strength (and damage +3 per level; CD steps down every 2)
 * ========================================================== */

export const ABILITY_UPGRADES = [
  // Costs are base “unlock” costs; cost scales per level using the same geometric model
  { key: 'claw',  title: 'Claw',      base: 50, mult: 1.30, type: 'ability' },
  { key: 'gust',  title: 'Wing Gust', base: 150, mult: 1.30, type: 'ability' },
  { key: 'roar',  title: 'Roar',      base: 300, mult: 1.30, type: 'ability' },
  { key: 'stomp', title: 'Stomp',     base: 500, mult: 1.30, type: 'ability' },
];

/** Live descriptions for abilities (matches combat/state scaling we discussed) */
function buildAbilityDesc(gs) {
  // Formulas mirror the earlier recommendations; tweak here if you change them in combat/state.
  const lv = (k) => abilityLvl(gs, k);

  const clawLv  = lv('claw');
  const gustLv  = lv('gust');
  const roarLv  = lv('roar');
  const stompLv = lv('stomp');

  // Claw: dmg 100 + 50/level; cooldown step ↓15% every 3 levels, min 1s from base 10.0
  const clawDmg = 100 + 50 * clawLv;
  const clawSteps = Math.floor(clawLv / 3);
  const clawCD = Math.max(1, 10.0 * Math.pow(0.85, clawSteps));

  // Gust: push tiles = min(6, 2 + 1/level); cooldown step ↓15% every 2 levels, min 5.0 from base 30.0
  const gustPush = Math.min(6, 2 + gustLv);
  const gustSteps = Math.floor(gustLv / 2);
  const gustCD = Math.max(5.0, 30.0 * Math.pow(0.85, gustSteps));

  // Roar: stun 1.5 + 0.25/level; cooldown step ↓15% every 2 levels, min 15.0 from base 60.0
  const roarStun = (1.5 + 0.25 * roarLv);
  const roarSteps = Math.floor(roarLv / 2);
  const roarCD = Math.max(15.0, 60.0 * Math.pow(0.85, roarSteps));
  // (sense/herding multipliers are fixed, applied in combat)

  // Stomp: slow = 20% + 3%/level (cap to 70% slow); dmg 20 + 10/level; cooldown step ↓15% every 2 levels, min 10.0 from base 30.0
  const stompSlow = Math.min(0.70, 0.20 + 0.03 * stompLv); // fraction slowed (e.g., 0.35 = 35% slow)
  const stompDmg = 20 + 10 * stompLv;
  const stompSteps = Math.floor(stompLv / 2);
  const stompCD = Math.max(10.0, 30.0 * Math.pow(0.85, stompSteps));

  return {
    claw:  `DMG: ${Math.round(clawDmg)}`,
    gust:  `Push: ${gustPush} tiles`,
    roar:  `Stun: ${roarStun.toFixed(2)}s`,
    stomp: `Slow: ${(stompSlow*100)|0}%  •  Damage: ${stompDmg}`,
  };
}

/* ============================================================
 * Public API expected by ui.js
 * ========================================================== */

/**
 * Attempt to buy upgrade by key.
 * - Deducts gold if affordable.
 * - Increments the correct store:
 *     • stats -> gs.upgrades[key]
 *     • abilities -> gs.upgrades[key]
 * - Returns true/false.
 */
export function buyUpgrade(gs = GameState, key) {
  // Find in either list
  let def = STAT_UPGRADES.find(d => d.key === key);
  let store = 'upgrades';
  if (!def) {
    def = ABILITY_UPGRADES.find(d => d.key === key);
    store = def ? 'upgrades' : store;
  }
  if (!def) return false;

  const level = (store === 'upgrades') ? statLvl(gs, key) : abilityLvl(gs, key);
  const price = costFor(def, level);
  if ((gs.gold | 0) < price) return false;

  gs.gold = (gs.gold | 0) - price;
  if (!gs[store]) gs[store] = {};
  gs[store][key] = level + 1;
  return true;
}
