// upgrades.js — infinite upgrades; UI shows actual current values

import { GameState, getDragonStats, GRID } from './state.js';

/**
 * Upgrade definitions:
 * - key:   gs.upgrades[key] holds integer level (default 0)
 * - title: display name
 * - base:  base gold cost at level 0 -> 1
 * - mult:  geometric cost growth per level
 *
 * No max caps — upgrades are infinite.
 */
export const UPGRADE_DEFS = [
  { key: 'power', title: 'Fire Power', base: 20, mult: 1.35 },
  { key: 'rate',  title: 'Fire Rate',  base: 25, mult: 1.35 },
  { key: 'range', title: 'Flame Range',base: 30, mult: 1.28 },
  { key: 'burn',  title: 'Burn DoT',   base: 22, mult: 1.35 },
];

/** Utility: get current level (safe 0 default) */
function lvl(gs, key) {
  return Math.max(0, (gs.upgrades?.[key] | 0));
}

/** Cost function (geometric) for going from level L -> L+1 */
function costFor(def, level) {
  const L = Math.max(0, level);
  return Math.round(def.base * Math.pow(def.mult, L));
}

/** Build a human-readable desc from the *current* dragon stats */
function buildDesc(gs) {
  const ds = getDragonStats(gs); // uses upgrade levels to compute live stats
  // Power: breathPower is “damage per tick/shot” in combat cone
  const power   = Math.round(ds.breathPower);
  // Rate: shots per second
  const rate    = ds.fireRate.toFixed(2);
  // Range: show pixels and tiles for clarity
  const pxRange = Math.round(ds.breathRange);
  const tiles   = (ds.breathRange / GRID.tile).toFixed(1);
  // Burn: DPS x duration
  const burnDps = ds.burnDPS.toFixed(1);
  const burnDur = ds.burnDuration.toFixed(1);

  return {
    power: `Damage: ${power}`,
    rate:  `Rate: ${rate} /s`,
    range: `Reach: ${pxRange}px (${tiles} tiles)`,
    burn:  `Burn: ${burnDps} DPS for ${burnDur}s`,
  };
}

/**
 * Public: returns array of { key, title, level, cost, desc }
 * for UI rendering. Desc strings reflect actual *current* values.
 */
export function getUpgradeInfo(gs = GameState) {
  const live = buildDesc(gs);
  return UPGRADE_DEFS.map(def => {
    const level = lvl(gs, def.key);
    const cost  = costFor(def, level);
    const desc  = live[def.key] || '';
    return {
      key: def.key,
      title: def.title,
      level,
      cost,
      desc,
      // kept for compatibility with any UI that checks these:
      max: undefined,
      isMax: false,
    };
  });
}

/**
 * Public: attempt to buy upgrade by key.
 * - Deducts gold if affordable.
 * - Increments gs.upgrades[key].
 * - Returns true/false.
 */
export function buyUpgrade(gs = GameState, key) {
  const def = UPGRADE_DEFS.find(d => d.key === key);
  if (!def) return false;

  const level = lvl(gs, key);
  const price = costFor(def, level);
  if ((gs.gold | 0) < price) return false;

  gs.gold = (gs.gold | 0) - price;
  gs.upgrades = gs.upgrades || {};
  gs.upgrades[key] = level + 1;
  return true;
}
