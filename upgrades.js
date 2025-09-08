// upgrades.js — builds the Upgrades panel + purchase logic

import * as state from './state.js'; // for getDragonStats and ladders if needed

function ensureUpgrades(gs) {
  gs.upgrades = gs.upgrades || {};
  const u = gs.upgrades;
  // ensure numeric defaults
  u.power = u.power | 0;
  u.reach = u.reach | 0;
  u.speed = u.speed | 0;
  u.burn  = u.burn  | 0;
  u.claws = u.claws | 0;
  u.wings = u.wings | 0;
  u.regen = u.regen | 0;
  return u;
}

// Gentle cost curve: base * (lvl + 1), with low bases
const COST_BASE = {
  power: 10,
  reach: 12,
  speed: 14,
  burn:  16,
  claws: 14,
  wings: 14,
  regen: 12,
};

export function getUpgradeInfo(gs) {
  ensureUpgrades(gs);
  const L = state.LADDERS || {};
  const rows = [
    { key: 'power', name: 'Power', max: (L.power||[]).length-1, base: COST_BASE.power },
    { key: 'reach', name: 'Reach', max: (L.reach||[]).length-1, base: COST_BASE.reach },
    { key: 'speed', name: 'Speed', max: (L.speed||[]).length-1, base: COST_BASE.speed },
    { key: 'burn',  name: 'Burn DpS', max: (L.burn ||[]).length-1, base: COST_BASE.burn  },
    { key: 'claws', name: 'Claws', max: (L.claws||[]).length-1, base: COST_BASE.claws },
    { key: 'wings', name: 'Wings', max: (L.wings||[]).length-1, base: COST_BASE.wings },
    { key: 'regen', name: 'Regen', max: (L.regen||[]).length-1, base: COST_BASE.regen },
  ];

  // compute lvl/cost/afford per row
  for (let r of rows) {
    const lvl = (gs.upgrades[r.key] | 0);
    r.lvl = lvl;
    r.max = r.max < 0 ? 0 : r.max;
    r.atMax = lvl >= r.max;
    r.cost = r.atMax ? 0 : (r.base * (lvl + 1));
    r.canBuy = !r.atMax && (gs.gold | 0) >= r.cost;
  }
  return rows;
}

export function buyUpgrade(gs, key) {
  ensureUpgrades(gs);
  const info = getUpgradeInfo(gs).find(function (x) { return x.key === key; });
  if (!info) return false;
  if (info.atMax) return false;
  if ((gs.gold | 0) < info.cost) return false;
  gs.gold = (gs.gold | 0) - info.cost;
  gs.upgrades[key] = (gs.upgrades[key] | 0) + 1;
  return true;
}

// Renders the panel your ui.js calls.
export function renderUpgrades(gs, el, helpers) {
  ensureUpgrades(gs);
  if (!el) return;
  const toast = helpers && helpers.toast;
  const rows = getUpgradeInfo(gs);

  // Clear
  while (el.firstChild) el.removeChild(el.firstChild);

  rows.forEach(function (r) {
    const row = document.createElement('div');
    row.className = 'uRow';

    const name = document.createElement('div');
    name.textContent = r.name + ' (Lv ' + r.lvl + (r.atMax ? ' / MAX' : '') + ')';

    const right = document.createElement('div');
    const btn = document.createElement('button');
    btn.textContent = r.atMax ? 'Maxed' : ('Buy ' + r.cost + 'g');
    btn.disabled = r.atMax || !r.canBuy;
    btn.addEventListener('click', function () {
      if (buyUpgrade(gs, r.key)) {
        if (toast) toast('Bought ' + r.name + ' (Lv ' + (r.lvl + 1) + ')', 900);
        // Re-render to update costs/levels/affordability
        renderUpgrades(gs, el, helpers);
      } else {
        if (toast) toast('Cannot buy ' + r.name, 900);
      }
    });

    right.appendChild(btn);
    row.appendChild(name);
    row.appendChild(right);
    el.appendChild(row);
  });
}
