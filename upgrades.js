// upgrades.js — upgrade data, purchase logic, and simple UI renderer
// Works with the new state.js API (no GameState singleton).
// Expects callers to pass the current GameState object `gs`.

import { LADDERS } from './state.js';

// ---- Data helpers ----
export function getUpgradeInfo(gs) {
  const u = gs?.upgrades ?? { power: 0, reach: 0, speed: 0, burn: 0 };
  return [
    {
      key: 'power',
      name: 'Power',
      lvl: u.power | 0,
      max: (LADDERS.power?.length ?? 1) - 1,
      cost: 20 * ((u.power | 0) + 1),
      desc: 'Increase direct hit damage',
    },
    {
      key: 'reach',
      name: 'Reach',
      lvl: u.reach | 0,
      max: (LADDERS.reach?.length ?? 1) - 1,
      cost: 25 * ((u.reach | 0) + 1),
      desc: 'Affects tiles in breath',
    },
    {
      key: 'speed',
      name: 'Speed',
      lvl: u.speed | 0,
      max: (LADDERS.speed?.length ?? 1) - 1,
      cost: 30 * ((u.speed | 0) + 1),
      desc: 'Breaths per second',
    },
    {
    key: 'regen', name: 'Regen',
    lvl: u.regen | 0,
    max: (LADDERS.regen.length - 1),
    cost: 30 * ((u.regen | 0) + 1), // tweakable; see next section
    desc: 'HP recovered between waves',
    },
    {
      key: 'burn',
      name: 'Burn',
      lvl: u.burn | 0,
      max: (LADDERS.burn?.length ?? 1) - 1,
      cost: 35 * ((u.burn | 0) + 1),
      desc: 'Burn DPS over duration',
    },
  ];
}

// ---- Purchase logic ----
export function buyUpgrade(gs, key) {
  if (!gs || !gs.upgrades) return false;
  const info = getUpgradeInfo(gs).find(x => x.key === key);
  if (!info) return false;
  if (info.lvl >= info.max) return false;
  if ((gs.gold | 0) < info.cost) return false;

  gs.gold = (gs.gold | 0) - info.cost;
  gs.upgrades[key] = (gs.upgrades[key] | 0) + 1;
  return true;
}

// ---- Optional UI renderer for the Upgrades panel ----
// Call: renderUpgrades(gs, containerEl, { toast })
export function renderUpgrades(gs, container, { toast } = {}) {
  if (!container) return;

  const info = getUpgradeInfo(gs);
  container.innerHTML = ''; // clear

  info.forEach(row => {
    const wrap = document.createElement('div');
    wrap.className = 'uRow';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = row.name;
    const meta = document.createElement('small');
    meta.textContent = `Lv ${row.lvl}/${row.max} — ${row.desc}`;
    meta.style.display = 'block';
    meta.style.opacity = '.8';
    meta.style.marginTop = '2px';
    left.appendChild(title);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = row.lvl >= row.max ? 'Maxed' : `Buy ${row.cost}g`;

      const disabled =
      row.lvl >= row.max || (gs.gold | 0) < row.cost;

    btn.addEventListener('click', () => {
      if (buyUpgrade(gs, row.key)) {
        if (toast) toast(`${row.name} +1`);
        // Re-render list to reflect new levels / gold
        renderUpgrades(gs, container, { toast });
        // quick HUD refresh for Gold without importing ui.js
        const goldEl = document.getElementById('gold');
        if (goldEl) goldEl.textContent = String(gs.gold | 0);
      } else {
        if (toast) {
          if (row.lvl >= row.max) toast(`${row.name} is maxed`);
          else if ((gs.gold | 0) < row.cost) toast('Not enough gold');
          else toast('Upgrade failed');
        }
      }
    });

    wrap.appendChild(left);
    wrap.appendChild(btn);
    container.appendChild(wrap);
  });
}
