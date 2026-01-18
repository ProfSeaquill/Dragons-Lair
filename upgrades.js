// upgrades.js — fire stat upgrades + ability upgrades (Claw/Gust/Roar/Stomp)
// upgrades.js (imports)
import { GameState, GRID, getCfg, 
        getDragonStatsTuned, getClawStatsTuned, getGustStatsTuned, 
        getRoarStatsTuned, getStompStatsTuned, getDragonStatsBase } from './state.js';
import { getVentConfig } from './combat/upgrades/abilities/vents.js';



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

// ---- Price model: level-only (no stat coupling) ----
// Cost(L) = baseCost * (1 + r*L) + add*L + q*L^2
function levelOnlyPrice(baseCost, level, kind, gs) {
  const P   = (getCfg(gs)?.tuning?.pricing) || {};
  const cfg = (kind === 'ability') ? (P.ability || P.stat || {}) : (P.stat || {});
  const r   = (typeof cfg.perLevelR   === 'number') ? cfg.perLevelR   : 0.20; // ~Base*(1 + 0.2*L)
  const add = (typeof cfg.perLevelAdd === 'number') ? cfg.perLevelAdd : 0.0;
  const q   = (typeof cfg.perLevelQ   === 'number') ? cfg.perLevelQ   : 0.0;

  const L = Math.max(0, level | 0);                  // buying L -> L+1
  const val = baseCost * (1 + r*L) + add*L + q*L*L;
  return Math.max(1, Math.round(val));
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
  const baseMap = {
    power: T.costBasePower ?? 20,
    rate:  T.costBaseRate  ?? 25,
    range: T.costBaseRange ?? 30,
    burn:  T.costBaseBurn  ?? 22,
  };
  const baseCost = baseMap[key];
  if (typeof baseCost !== 'number') return 999999;
  return levelOnlyPrice(baseCost, level, 'stat', gs);
}

function abilityCostFor(gs, key, level) {
  const T = getCfg(gs)?.tuning || {};
  const baseMap = {
    claw:   T.abilities?.costBaseClaw   ?? 30,
    vents:  T.abilities?.costBaseVents  ?? 200,
    gust:   T.abilities?.costBaseGust   ?? 50,
    roar:   T.abilities?.costBaseRoar   ?? 70,
    stomp:  T.abilities?.costBaseStomp  ?? 90,
  };
  const baseCost = baseMap[key];
  if (typeof baseCost !== 'number') return 999999;
  return levelOnlyPrice(baseCost, level, 'ability', gs);
}




/** Safe getters for current levels in both stores */
function statLvl(gs, key) {
  const raw = (gs.upgrades?.[key] | 0);
  return Math.min(CAP_LEVEL, Math.max(0, raw));
}

function abilityLvl(gs, key) {
  const raw = (gs.upgrades?.[key] | 0);
  return Math.min(ABILITY_MAX_LEVEL, Math.max(0, raw));
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

const ABILITY_MAX_LEVEL = 10;
const CAP_LEVEL = 10;

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
  { key: 'claw',   title: 'Claw',        base: 50,  mult: 1.30, type: 'ability' },
  { key: 'gust',   title: 'Wing Gust',   base: 150, mult: 1.30, type: 'ability' },
  { key: 'roar',   title: 'Roar',        base: 300, mult: 1.30, type: 'ability' },
  { key: 'stomp',  title: 'Stomp',       base: 500, mult: 1.30, type: 'ability' },
  { key: 'vents',  title: 'Flame Vents', base: 200, mult: 1.30, type: 'ability' },
];


/** Live descriptions for abilities (matches combat/state scaling we discussed) */
function buildAbilityDesc(gs) {
  const cs  = getClawStatsTuned(gs);
  const gsT = getGustStatsTuned(gs);
  const rs  = getRoarStatsTuned(gs);
  const ss  = getStompStatsTuned(gs);

  // 🔥 Flame Vents: ask vents.js for the canonical numbers
  let ventsLine = '';
  try {
    const vc = getVentConfig(gs);        // { dps, maxCount, maxCountCfg, ... }

    const countNow = vc?.maxCount ?? 0;      // effective vent cap at this level
    const peak     = vc?.maxCountCfg ?? countNow; // theoretical max from tuning (for /X display)
    const dpsNow   = vc?.dps ?? 0;

    ventsLine = `Vents: ${countNow}/${peak} tiles  •  ${dpsNow.toFixed(1)} DPS per tile`;
  } catch (err) {
    console.warn('[upgrades] vent desc failed:', err);
    ventsLine = 'Vents: flame tiles that deal DPS over time';
  }

  return {
    claw:   `DMG: ${Math.round(cs.dmg)}  •  CD: ${cs.cd.toFixed(2)}s`,
    gust:   `Push: ${gsT.pushTiles} tiles  •  CD: ${gsT.cd.toFixed(2)}s`,
    roar:   `Stun: ${rs.stunSec.toFixed(2)}s  •  CD: ${rs.cd.toFixed(2)}s`,
    stomp:  `Slow: ${Math.round((1 - ss.slowMult) * 100)}%  •  DMG: ${ss.dmg}  •  CD: ${ss.cd.toFixed(2)}s`,
    vents:  ventsLine,
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
if (def.type === 'stat'     && level >= CAP_LEVEL)          return false; // hard cap for stats
if (def.type === 'ability'  && level >= ABILITY_MAX_LEVEL)  return false; // hard cap for abilities
        
  const price = (def.type === 'stat')
    ? statCostFor(gs, key, level)
    : abilityCostFor(gs, key, level);

  if ((gs.gold | 0) < price) return false;

  gs.gold = (gs.gold | 0) - price;
  (gs.upgrades || (gs.upgrades = {}));
  gs.upgrades[key] = level + 1;
  return true;
}

