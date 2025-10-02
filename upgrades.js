// upgrades.js — fire stat upgrades + ability upgrades (Claw/Gust/Roar/Stomp)

import { GameState, getDragonStats, GRID } from './state.js';
import { getCfg } from './state.js';

/* ============================================================
 * Cost model (unchanged for stats; also used for abilities)
 * ========================================================== */

/** Cost function (geometric) for going from level L -> L+1 */
function costFor(def, level) {
  const L = Math.max(0, level | 0);
  return Math.round(def.base * Math.pow(def.mult, L));
}

/** Safe getters for current levels in both stores */
function statLvl(gs, key) {
  return Math.max(0, (gs.upgrades?.[key] | 0));
}
function abilityLvl(gs, key) {
  return Math.max(0, (gs.upgrades?.[key] | 0));
}


// If you already have a STATIC_UPGRADES constant, keep it.
// Prefer config when provided; fall back to static.
export function listUpgrades(gs) {
  const cfg = getCfg(gs);
  const fromCfg = cfg.upgrades;

  // If cfg.upgrades is present and non-empty, prefer it.
  const hasCfg = fromCfg && (
    (Array.isArray(fromCfg) && fromCfg.length > 0) ||
    (!Array.isArray(fromCfg) && Object.keys(fromCfg).length > 0)
  );

  // Optional: shallow-clone to avoid accidental UI mutation
  if (hasCfg) {
    return Array.isArray(fromCfg) ? fromCfg.slice() : { ...fromCfg };
  }
  return Array.isArray(STATIC_UPGRADES) ? STATIC_UPGRADES.slice() : { ...STATIC_UPGRADES };
}


/* ============================================================
 * Part A: FIRE STAT UPGRADES (your original ones)
 * ========================================================== */

export const STAT_UPGRADES = [
  { key: 'power', title: 'Fire Power',  base: 20, mult: 1.35, type: 'stat' },
  { key: 'rate',  title: 'Fire Rate',   base: 25, mult: 1.35, type: 'stat' },
  { key: 'range', title: 'Flame Range', base: 30, mult: 1.28, type: 'stat' },
  { key: 'burn',  title: 'Burn DoT',    base: 22, mult: 1.25, type: 'stat' },
];

/** Build live description strings for the stat upgrades using current dragon stats */
function buildFireDesc(gs) {
  const ds = getDragonStats(gs);
  const power   = Math.round(ds.breathPower);
  const rate    = ds.fireRate.toFixed(2); // shots/sec
  const pxRange = Math.round(ds.breathRange);
  const tiles   = (ds.breathRange / GRID.tile).toFixed(1);
  const burnDps = ds.burnDPS.toFixed(1);
  const burnDur = ds.burnDuration.toFixed(1);

  return {
    power: `Damage: ${power}`,
    rate:  `Rate: ${rate} /s`,
    range: `Reach: ${tiles} tiles)`,
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
 * Returns array of { key, title, level, cost, desc, type }
 * - Stat upgrades read/write gs.upgrades[key]
 * - Ability upgrades read/write gs.upgrades[key]
 * - Abilities are appended AFTER stat upgrades so they appear last
 */
export function getUpgradeInfo(gs = GameState) {
  const statLive = buildFireDesc(gs);
  const abilityLive = buildAbilityDesc(gs);

  // Stats first
  const statRows = STAT_UPGRADES.map(def => {
    const level = statLvl(gs, def.key);
    return {
      key: def.key,
      title: def.title,
      level,
      cost: costFor(def, level),
      desc: statLive[def.key] || '',
      max: undefined,
      isMax: false,
      type: def.type, // 'stat'
    };
  });

  // Abilities after (so they’re grouped at the end/side)
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
