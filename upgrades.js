// upgrades.js — fire stat upgrades + ability upgrades (Claw/Gust/Roar/Stomp)
// upgrades.js (imports)
import { GameState, GRID, getCfg, 
        getDragonStatsTuned, getClawStatsTuned, getGustStatsTuned, 
        getRoarStatsTuned, getStompStatsTuned, getDragonStatsBase } from './state.js';


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
    capDamage:        t.capDamage ?? 800,
    capRate:          t.capRate   ?? 2.5,
    capRangeTiles:    t.capRangeTiles ?? 30,
    capBurnDps:       t.capBurnDps ?? 15,
    capBurnDuration:  t.capBurnDuration ?? 2,

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

function abilityCostFor(gs, key, level) {
  const T = getCfg(gs)?.tuning || {};
  const shapes = {
    claw: {
      baseDmg: 100,  capDmg: (T.claw?.capDamage ?? 1000),   kDmg: (T.claw?.kDamage ?? 0.25),
      baseCd:  (T.claw?.baseCooldownSec ?? 10), minCd:(T.claw?.minCooldownSec ?? 5), kCd:(T.claw?.kCooldown ?? 0.25),
      baseCost: 100
    },
    gust: {
      basePush: 2, capPush:(T.gust?.capPushTiles ?? 15), kPush:(T.gust?.kPush ?? 0.35),
      baseCd:(T.gust?.baseCooldownSec ?? 30), minCd:(T.gust?.minCooldownSec ?? 5), kCd:(T.gust?.kCooldown ?? 0.30),
      baseCost: 220
    },
    roar: {
      baseStun: 1.5, capStun:(T.roar?.capStunSec ?? 6.0), kStun:(T.roar?.kStun ?? 0.25),
      baseCd:(T.roar?.baseCooldownSec ?? 60), minCd:(T.roar?.minCooldownSec ?? 15), kCd:(T.roar?.kCooldown ?? 0.25),
      baseCost: 400
    },
    stomp: {
      baseDmg: 20, capDmg:(T.stomp?.capDamage ?? 500), kDmg:(T.stomp?.kDamage ?? 0.25),
      baseSlow:(0.80), floorSlow:(T.stomp?.floorSlowMult ?? 0.30), kSlow:(T.stomp?.kSlow ?? 0.30),
      baseCd:(T.stomp?.baseCooldownSec ?? 30), minCd:(T.stomp?.minCooldownSec ?? 10), kCd:(T.stomp?.kCooldown ?? 0.30),
      baseCost: 500
    }
  };
  const S = shapes[key]; if (!S) return 999999;

  // “progress toward cap”: combine the stat that goes UP and the one(s) that go DOWN
  // For “down” stats (cooldowns, slowMult), progress is measured toward the MIN.
  let progUp = 0, progDown = 0;

  if (key === 'claw') {
    const nowD = approachCap(S.baseDmg, S.capDmg, level, S.kDmg);
    const nowC = approachMin(S.baseCd, S.minCd, level, S.kCd);
    progUp   = (nowD - S.baseDmg) / Math.max(1e-6, S.capDmg - S.baseDmg);
    progDown = (S.baseCd - nowC) / Math.max(1e-6, S.baseCd - S.minCd);
  } else if (key === 'gust') {
    const nowP = approachCap(S.basePush, S.capPush, level, S.kPush);
    const nowC = approachMin(S.baseCd, S.minCd, level, S.kCd);
    progUp   = (nowP - S.basePush) / Math.max(1e-6, S.capPush - S.basePush);
    progDown = (S.baseCd - nowC)   / Math.max(1e-6, S.baseCd - S.minCd);
  } else if (key === 'roar') {
    const nowS = approachCap(S.baseStun, S.capStun, level, S.kStun);
    const nowC = approachMin(S.baseCd, S.minCd, level, S.kCd);
    progUp   = (nowS - S.baseStun) / Math.max(1e-6, S.capStun - S.baseStun);
    progDown = (S.baseCd - nowC)   / Math.max(1e-6, S.baseCd - S.minCd);
  } else if (key === 'stomp') {
    const nowD = approachCap(S.baseDmg, S.capDmg, level, S.kDmg);
    const nowC = approachMin(S.baseCd, S.minCd, level, S.kCd);
    const nowSlow = approachMin(S.baseSlow, S.floorSlow, level, S.kSlow);
    const progSlow = (S.baseSlow - nowSlow) / Math.max(1e-6, S.baseSlow - S.floorSlow);
    const progDmg  = (nowD - S.baseDmg) / Math.max(1e-6, S.capDmg - S.baseDmg);
    const progCd   = (S.baseCd - nowC) / Math.max(1e-6, S.baseCd - S.minCd);
    // take the strongest among the three improvements
    progUp   = Math.max(progDmg, progSlow);
    progDown = progCd;
  }

  const progress = Math.max(0, Math.min(1, Math.max(progUp, progDown))); // conservative
  const p  = (getCfg(gs)?.tuning?.flame?.costP ?? 1.6);
  const bl = (getCfg(gs)?.tuning?.flame?.costBumpPerLevel ?? 0.05);

  return asymptoticCost({ baseCost: S.baseCost, progress, p, bumpPerLevel: bl, level });
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
  const isMax = level >= CAP_LEVEL;
  return {
    key: def.key,
    title: def.title,
    level,
    cost: isMax ? 0 : statCostFor(gs, def.key, level),
    desc: statLive[def.key] || '',
    max: CAP_LEVEL,
    isMax,
    type: def.type,
  };
});


  const abilityRows = ABILITY_UPGRADES.map(def => {
  const level = abilityLvl(gs, def.key);
  const isMax = level >= ABILITY_MAX_LEVEL;
  return {
    key: def.key,
    title: def.title,
    level,
    cost: isMax ? 0 : abilityCostFor(gs, def.key, level),
    desc: abilityLive[def.key] || '',
    max: undefined,
    isMax: false,
    max: ABILITY_MAX_LEVEL,
    isMax,
    type: def.type,
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

const ABILITY_MAX_LEVEL = 30;
const CAP_LEVEL = 30;

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
  const cs = getClawStatsTuned(gs);
  const gsT = getGustStatsTuned(gs);
  const rs = getRoarStatsTuned(gs);
  const ss = getStompStatsTuned(gs);
  return {
    claw:  `DMG: ${Math.round(cs.dmg)}  •  CD: ${cs.cd.toFixed(2)}s`,
    gust:  `Push: ${gsT.pushTiles} tiles  •  CD: ${gsT.cd.toFixed(2)}s`,
    roar:  `Stun: ${rs.stunSec.toFixed(2)}s  •  CD: ${rs.cd.toFixed(2)}s`,
    stomp: `Slow: ${Math.round((1-ss.slowMult)*100)}%  •  DMG: ${ss.dmg}  •  CD: ${ss.cd.toFixed(2)}s`,
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
  let def = STAT_UPGRADES.find(d => d.key === key) || ABILITY_UPGRADES.find(d => d.key === key);
  if (!def) return false;

  const level = (def.type === 'stat') ? statLvl(gs, key) : abilityLvl(gs, key);
  if (level >= CAP_LEVEL) return false; // hard cap for upgrades
  if (def.type === 'ability' && level >= ABILITY_MAX_LEVEL) return false; // hard cap for abilities
        
  const price = (def.type === 'stat')
    ? statCostFor(gs, key, level)
    : abilityCostFor(gs, key, level);

  if ((gs.gold | 0) < price) return false;

  gs.gold = (gs.gold | 0) - price;
  (gs.upgrades || (gs.upgrades = {}));
  gs.upgrades[key] = level + 1;
  return true;
}

