// upgrades.js — builds the Upgrades panel + purchase logic (UNLIMITED LEVELS; REGEN REMOVED)

import { nextUpgradeCost, UPGRADE_CONFIG } from './state.js';

function ensureUpgrades(gs) {
  gs.upgrades = gs.upgrades || {};
  const u = gs.upgrades;
  u.power = u.power | 0;
  u.reach = u.reach | 0;
  u.speed = u.speed | 0;
  u.burn  = u.burn  | 0;
  u.claws = u.claws | 0;
  u.wings = u.wings | 0;
  return u;
}

const ORDER = [
  ['power', 'Power'],
  ['speed', 'Speed'],
  ['reach', 'Reach'],
  ['burn',  'Burn DpS'],
  ['claws', 'Claws'],
  ['wings', 'Wings'],
  // regen removed
];

function hintFor(key) {
  const cfg = UPGRADE_CONFIG[key] || {};
  if ('effectGrowth' in cfg) {
    const pct = Math.round((cfg.effectGrowth - 1) * 100);
    return `+~${pct}%/lvl`;
  }
  if ('stepPerLevel' in cfg) return `+${cfg.stepPerLevel}/lvl`;
  return '';
}

export function getUpgradeInfo(gs) {
  ensureUpgrades(gs);
  return ORDER.map(([key, name]) => {
    const lvl  = gs.upgrades[key] | 0;
    const cost = nextUpgradeCost(key, gs.upgrades);
    return { key, name, lvl, cost, canBuy: (gs.gold|0) >= cost, atMax: false, hint: hintFor(key) };
  });
}

export function buyUpgrade(gs, key) {
  ensureUpgrades(gs);
  const info = getUpgradeInfo(gs).find(r => r.key === key);
  if (!info) return false;
  if ((gs.gold | 0) < info.cost) return false;
  gs.gold = (gs.gold | 0) - info.cost;
  gs.upgrades[key] = (gs.upgrades[key] | 0) + 1;
  return true;
}

export function renderUpgrades(gs, el, helpers) {
  ensureUpgrades(gs);
  if (!el) return;
  const toast = helpers && helpers.toast;
  const rows = getUpgradeInfo(gs);

  while (el.firstChild) el.removeChild(el.firstChild);

  rows.forEach(function (r) {
    const row = document.createElement('div');
    row.className = 'uRow';

    const name = document.createElement('div');
    name.innerHTML = `<strong>${r.name}</strong> <small>Lv ${r.lvl}${r.hint ? ` • ${r.hint}` : ''}</small>`;

    const right = document.createElement('div');
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = `Buy ${r.cost}g`;
    btn.disabled = !r.canBuy;
    btn.addEventListener('click', function () {
      if (buyUpgrade(gs, r.key)) {
        if (toast) toast(`Bought ${r.name} (Lv ${r.lvl + 1})`, 900);
        renderUpgrades(gs, el, helpers);
      } else {
        if (toast) toast(`Cannot buy ${r.name}`, 900);
      }
    });

    right.appendChild(btn);
    row.appendChild(name);
    row.appendChild(right);
    el.appendChild(row);
  });
}
