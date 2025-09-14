// upgrades.js — simple gold-based upgrades that feed into getDragonStats()

import { GameState } from './state.js';

/**
 * Upgrade definitions:
 * - key:      string used in gs.upgrades[key] (level integer, default 0)
 * - title:    display name
 * - base:     base gold cost at level 0 -> 1
 * - mult:     geometric cost growth per level
 * - max:      optional hard cap (undefined = no cap)
 * - desc(lv): optional function describing the effect at current level
 *
 * Effects are applied in state.getDragonStats(gs), which reads gs.upgrades.
 */
export const UPGRADE_DEFS = [
  {
    key: 'power',
    title: 'Fire Power',
    base: 20,
    mult: 1.35,
    max: 25,
    desc: (lv) => `+15% breath damage per level (Lv ${lv})`,
  },
  {
    key: 'rate',
    title: 'Fire Rate',
    base: 25,
    mult: 1.35,
    max: 20,
    desc: (lv) => `+10% shots/sec per level (Lv ${lv})`,
  },
  {
    key: 'range',
    title: 'Flame Range',
    base: 30,
    mult: 1.28,
    max: 20,
    desc: (lv) => `+5% range per level (Lv ${lv})`,
  },
  {
    key: 'burn',
    title: 'Burn DoT',
    base: 22,
    mult: 1.35,
    max: 15,
    desc: (lv) => `+15% burn DPS & +0.5s duration per level (Lv ${lv})`,
  },
];

/** Utility: get current level (safe 0 default) */
function lvl(gs, key) {
  return Math.max(0, (gs.upgrades?.[key] | 0));
}

/** Cost function (geometric) for going from level L -> L+1 */
function costFor(def, level) {
  // clamp level for cost growth (no negative)
  const L = Math.max(0, level);
  return Math.round(def.base * Math.pow(def.mult, L));
}

/**
 * Public: returns array of { key, title, level, cost, max, desc }
 * for UI rendering.
 */
export function getUpgradeInfo(gs = GameState) {
  return UPGRADE_DEFS.map(def => {
    const level = lvl(gs, def.key);
    const capped = (def.max != null) && level >= def.max;
    return {
      key: def.key,
      title: def.title,
      level,
      cost: capped ? 'MAX' : costFor(def, level),
      max: def.max,
      desc: typeof def.desc === 'function' ? def.desc(level) : (def.desc || ''),
      isMax: capped,
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
  if (def.max != null && level >= def.max) return false;

  const price = costFor(def, level);
  if ((gs.gold | 0) < price) return false;

  gs.gold = (gs.gold | 0) - price;
  gs.upgrades = gs.upgrades || {};
  gs.upgrades[key] = level + 1;

  // Optional: nudge dragonHP up when max HP increases (quality-of-life)
  if (key === 'hp') {
    // Let main/combat clamp to new max on next tick; or do a soft top-up:
    // (commented out by default; uncomment if you prefer auto-heal-on-HP-up)
    // const { getDragonStats } = await import('./state.js');  // avoid cycle
    // const ds = getDragonStats(gs);
    // gs.dragonHP = Math.min(ds.maxHP, gs.dragonHP + 10);
  }

  return true;
}
