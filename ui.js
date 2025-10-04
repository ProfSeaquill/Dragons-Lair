// ui.js — edge-wall build mode + HUD + Next Wave preview
import * as state from './state.js';
import { toggleEdge, edgeHasWall, recomputePath } from './pathing.js';
import { getUpgradeInfo, listUpgrades } from './upgrades.js';
import { getCfg } from './state.js';

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const hud = {
  wave:    $('wave'),
  hp:      $('dragonHP'),
  gold:    $('gold'),
  bones:   $('bones'),
  msg:     $('msg'),
  healBtn: $('healBtn'),
  start:   $('startBtn'),
  auto:    $('autoStart'),
  save:    $('saveBtn'),
  load:    $('loadBtn'),
  canvas:  $('game'),
  upgrades: $('upgrades'),
  preview:  $('preview'),
  clear:   $('clearBtn'),
}

// For render.js hover highlight
state.GameState.uiHoverEdge = null;

// ---------- Enemy meta for the Preview ----------
const ENEMY_META = {
  villager:   { name: 'Villager',  color: '#9acd32', blurb: 'Basic grunt. Slow and squishy.' },
  squire:     { name: 'Squire',    color: '#7fd1ff', blurb: 'A bit tougher and quicker than a villager.' },
  knight:     { name: 'Knight',    color: '#ffd166', blurb: 'Fast mover with solid armor and damage.' },
  hero:       { name: 'Hero',      color: '#ff6b6b', blurb: 'Shield-bearer: blocks direct fire for units behind him.' },
  engineer:   { name: 'Engineer',  color: '#c084fc', blurb: 'Tunnels to the lair and plants a timed bomb.' },
  kingsguard: { name: 'King\'s Guard', color: '#ffa8a8', blurb: 'Miniboss: heavier Knight, moves a bit slower.' },
  boss:       { name: 'Knight of the Round Table', color: '#f4a261', blurb: 'Boss: massive HP; a real push.' },
};

// Cache the combat module (so we can ask it for wave composition)
let _combatMod = null;
async function getCombat() {
  if (_combatMod) return _combatMod;
  _combatMod = await import('./combat.js');
  return _combatMod;
}

// ---------- Public API ----------
export function bindUI() {
  wireButtons();
  wireCanvasEdgeBuild();
  renderUpgradesPanel();
  refreshHUD();          // also triggers first preview render
  recomputePath(state.GameState);

  // Dev tools
  ensureDevPanel();

  window.dispatchEvent(new CustomEvent('dl-boot-ok'));
}

// Track last values so we only rebuild when needed
let _lastPreviewWave = -1;
let _lastGold = -1;
let _lastWaveHUD = -1;
let _lastBones = -1;
let _lastHPStr = '';
let _lastAuto = null;


// ---------- Optional small API for main/render ----------
export const UI = { refreshHUD, tell, renderUpgradesPanel };

export function refreshHUD() {
  const gs = state.GameState;
  const ds = state.getDragonStats(gs);

const waveNow  = gs.wave | 0;
const goldNow  = gs.gold | 0;
const bonesNow = gs.bones | 0;
const hpStrNow = `${gs.dragonHP | 0}/${ds.maxHP | 0}`;
const autoNow  = !!gs.autoStart;

if (hud.wave && waveNow !== _lastWaveHUD) { _lastWaveHUD = waveNow; hud.wave.textContent = String(waveNow); }
if (hud.gold && goldNow !== _lastGold)    { _lastGold = goldNow;   hud.gold.textContent = String(goldNow); }
if (hud.bones && bonesNow !== _lastBones) { _lastBones = bonesNow; hud.bones.textContent = String(bonesNow); }
if (hud.hp && hpStrNow !== _lastHPStr)    { _lastHPStr = hpStrNow; hud.hp.textContent = hpStrNow; }
if (hud.auto && autoNow !== _lastAuto)    { _lastAuto = autoNow;   hud.auto.checked = autoNow; }

  // Dev: keep topped up if infiniteMoney is on
  if (gs.dev?.infiniteMoney) {
    if ((gs.gold | 0) < 500_000)  gs.gold  = 1_000_000;
    if ((gs.bones | 0) < 500_000) gs.bones = 1_000_000;
  }

  // Rebuild upgrade buttons when gold changes so disabled/enabled updates live
  if ((gs.gold | 0) !== _lastGold) {
    _lastGold = gs.gold | 0;
    renderUpgradesPanel(); // <-- ensure correct casing
  }

  // Only rebuild the Next Wave preview when the wave number changes
  if ((gs.wave | 0) !== _lastPreviewWave) {
    _lastPreviewWave = gs.wave | 0;
    renderNextWavePreview().catch(err => console.warn('preview failed:', err));
  }

  renderHealButtonLabel(gs);
  
  // keep this LAST so it always reflects current config
  renderGridHelp(gs);
}


// Lightweight message banner
function tell(s, color = '') {
  if (!hud.msg) return;
  const same = (hud.msg.textContent === String(s)) && (hud.msg.style.color === (color || ''));
  if (!same) {
    hud.msg.textContent = String(s);
    hud.msg.style.color = color || '';
  }
  if (s) {
    clearTimeout(tell._t);
    tell._t = setTimeout(() => { if (hud.msg.textContent === s) hud.msg.textContent = ''; }, 2500);
  }
}

  
// ---------- Buttons / HUD wiring ----------
function wireButtons() {
  const gs = state.GameState;

  if (hud.healBtn) {
    hud.healBtn.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('dl-heal'));
});
  }

  if (hud.start) {
    hud.start.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-start-wave'));
      tell('Wave starting...');
    });
  }

  if (hud.auto) {
    hud.auto.addEventListener('change', (e) => {
  window.dispatchEvent(new CustomEvent('dl-auto-start', { detail: !!e.target.checked }));
});

  }

  if (hud.save) {
    hud.save.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('dl-save'));
});
  }

  if (hud.load) {
   hud.load.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('dl-load'));
});
  }

    if (hud.clear) {
    hud.clear.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-save-clear'));
    });
  }

}

function renderHealButtonLabel(gs) {
  const btn = document.getElementById('healBtn');
  if (!btn) return;
  const costPerHP = (state.getCfg(gs).tuning.dragon.healCostBone | 0) || 1;
  const unit = costPerHP === 1 ? 'bone' : 'bones';
  btn.textContent = `Heal (1 HP / ${costPerHP} ${unit})`;
}

// ---------- upgrades panel ----------
function renderUpgradesPanel() {
  const root = hud.upgrades;
  if (!root) return;

  const data = listUpgrades(gs);
  const list = Array.isArray(data) ? data : Object.values(data);
  root.innerHTML = '';

  // Keep references to "Use" buttons so we can live-update them
  const useBtns = []; // { key: 'gust'|'roar'|'stomp', btn }

  list.forEach(info => {
    const row = document.createElement('div');
    row.className = 'uRow';

    const name  = document.createElement('div');
    const buy   = document.createElement('button');
    const small = document.createElement('small');

    name.textContent = `${info.title} (Lv ${info.level})`;
    small.textContent = info.desc || '';
    buy.className = 'btn';
    buy.textContent = `Buy ${info.cost}g`;
    buy.disabled = (state.GameState.gold | 0) < (info.cost | 0);

    buy.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('dl-upgrade-buy', {
    detail: { id: info.key, title: info.title, cost: info.cost }
  }));
});

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.appendChild(name);
    if (info.desc) left.appendChild(small);

    row.appendChild(left);
    row.appendChild(buy);

    // Ability "Use" buttons (Gust/Roar/Stomp)
    if (info.type === 'ability' && (info.key === 'gust' || info.key === 'roar' || info.key === 'stomp')) {
      const use = document.createElement('button');
      use.className = 'btn';

      use.textContent = 'Locked'; // live-updated below
      use.disabled = true;

      use.addEventListener('click', () => {
        const U = state.GameState.upgrades || {};
        const lvlNow = (U[info.key] | 0);
        if (lvlNow <= 0) return; // still locked
        if (info.key === 'gust')  state.GameState.reqWingGust = true;
        if (info.key === 'roar')  state.GameState.reqRoar     = true;
        if (info.key === 'stomp') state.GameState.reqStomp    = true;
      });

      row.appendChild(use);
      useBtns.push({ key: info.key, btn: use });
    }

    root.appendChild(row);
  });

  // ---- Live cooldown / lock updater ----
  (async function abilityUseUpdater() {
    const combat = await getCombat();
    if (typeof combat.getCooldowns !== 'function') return;

    const label = (base, s) => (s > 0.05 ? `${base} (${s.toFixed(1)}s)` : base);

    function tick() {
      const cds = combat.getCooldowns();
      for (const { key, btn } of useBtns) {
        const U = state.GameState.upgrades || {};
        const level = (U[key] | 0);
        const locked = level <= 0;

        if (locked) {
          btn.disabled = true;
          btn.textContent = 'Locked';
          btn.title = 'Buy at least 1 level to unlock';
        } else {
          const cd =
            key === 'gust'  ? (cds.gust  || 0) :
            key === 'roar'  ? (cds.roar  || 0) :
            key === 'stomp' ? (cds.stomp || 0) : 0;

          btn.disabled = cd > 0.05;
          btn.textContent = label('Use', cd);
          btn.title = cd > 0.05 ? `${key} on cooldown` : `Activate ${key}`;
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();
} // <-- closes renderUpgradesPanel()

// Wall instructional text
function renderGridHelp(gs) {
  const el = document.querySelector('.gridHelp');
  if (!el) return;
  const cost = (getCfg(gs).tuning.economy.wallCostBones | 0) || 1;
  el.textContent =
    `Build Mode: Click a TILE EDGE to add a wall (${cost} bone). ` +
    `Right-click an edge wall to remove. Walls cannot fully block entry ↔ exit.`;
  

// ---------- Canvas Edge Build Mode ----------
function wireCanvasEdgeBuild() {
  const cv = hud.canvas;
  if (!cv) return;

  // Prevent default context menu for right-click remove
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  cv.addEventListener('mousemove', (e) => {
    const hover = edgeHitTest(cv, e);
    state.GameState.uiHoverEdge = hover; // for render highlight
    if (hover) {
      const hasWall = edgeHasWall(state.GameState, hover.x, hover.y, hover.side);
      const verb = hasWall ? 'Remove' : 'Place';
      const cost = hasWall ? `(+${state.COSTS.edgeRefund} bones)` : `(${state.COSTS.edgeWall} bones)`;
      tell(`${verb} wall: (${hover.x},${hover.y}) ${hover.side} ${cost}`, '#9cf');
    }
  });

  cv.addEventListener('mouseleave', () => {
    state.GameState.uiHoverEdge = null;
  });

  // (optional) disable right-click context menu on the canvas
  cv.addEventListener('contextmenu', e => e.preventDefault());
  
  cv.addEventListener('mousedown', (e) => {
  const hover = edgeHitTest(cv, e);
  if (!hover) return;

  const place  = (e.button === 0);
  const remove = (e.button === 2);
  if (!place && !remove) return;

  const gs = state.GameState;
  const hasWall = edgeHasWall(gs, hover.x, hover.y, hover.side);
  if (place && hasWall) return;
  if (remove && !hasWall) return;

  if (place) {
    const cost = (state.getCfg(gs).tuning.economy.wallCostBones | 0) || 1;
    if ((gs.bones | 0) < cost) {
      UI.tell?.('Not enough bones');
      return;
    }

    // Attempt to place
    toggleEdge(gs, hover.x, hover.y, hover.side);

    // If placement was rejected (e.g., would fully block entry↔exit), don't charge
    const placed = edgeHasWall(gs, hover.x, hover.y, hover.side);
    if (!placed) {
      UI.tell?.("Can't block entry ↔ exit");
      return;
    }

    // Charge after successful placement
    gs.bones -= cost;

    globalThis.Telemetry?.log('wall:place', { x: hover.x, y: hover.y, side: hover.side, cost });

  } else if (remove) {
    // Remove (no refund; add one if you want)
    toggleEdge(gs, hover.x, hover.y, hover.side);
    globalThis.Telemetry?.log('wall:remove', { x: hover.x, y: hover.y, side: hover.side });

    // Example refund logic if you decide to support it later:
    // const refund = (state.getCfg(gs).tuning.economy.wallRefundBones | 0) || 0;
    // if (refund) gs.bones += refund;
  }

  recomputePath(gs);
  UI.refreshHUD?.();
});

function edgeHitTest(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (evt.clientX - rect.left) * scaleX;
  const my = (evt.clientY - rect.top) * scaleY;

  const t = state.GRID.tile;
  const cx = Math.floor(mx / t);
  const cy = Math.floor(my / t);
  if (!state.inBounds(cx, cy)) return null;

  const lx = mx - cx * t;
  const ly = my - cy * t;
  const edgePad = Math.max(4, Math.floor(t * 0.12));

  let side = null, dist = Infinity;
  const dN = ly;          if (dN <= edgePad && dN < dist) { side = 'N'; dist = dN; }
  const dS = t - ly;      if (dS <= edgePad && dS < dist) { side = 'S'; dist = dS; }
  const dW = lx;          if (dW <= edgePad && dW < dist) { side = 'W'; dist = dW; }
  const dE = t - lx;      if (dE <= edgePad && dE < dist) { side = 'E'; dist = dE; }

  if (!side) return null;
  return { x: cx, y: cy, side };
}

function edgeHasWall(gs, x, y, side) {
  const rec = state.ensureCell(gs, x, y);
  return !!rec?.[side];
}


function edgeTouchesDragon(gs, x, y, side) {
  // side is 'N','S','E','W' for the edge on cell (x,y)
  const a = { x, y };
  const b = { x, y };
  if (side === 'N') b.y = y - 1;
  if (side === 'S') b.y = y + 1;
  if (side === 'W') b.x = x - 1;
  if (side === 'E') b.x = x + 1;

  // If either cell is part of the dragon, block building
  return state.isDragonCell(a.x, a.y, gs) || state.isDragonCell(b.x, b.y, gs);
}

// ---------- Next Wave Preview ----------
async function renderNextWavePreview() {
  const root = hud.preview;
  if (!root) return;
  root.innerHTML = '';

  const combat = await getCombat();
  const wave = state.GameState.wave | 0;

  // Get the raw list, then count by type
  const list = (typeof combat.previewWaveList === 'function')
    ? combat.previewWaveList(wave)
    : [];

  const counts = {};
  for (const type of list) counts[type] = (counts[type] | 0) + 1;

  // Build rows in a consistent order
  const order = ['villager','squire','knight','hero','engineer','kingsguard','boss'];
  order.forEach((type) => {
    const n = counts[type] | 0;
    if (n <= 0) return;

    const meta = ENEMY_META[type] || { name: type, color: '#ccc', blurb: '' };

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '28px 1fr auto';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.margin = '6px 0';

    // Icon (colored circle via inline SVG)
    const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ico.setAttribute('width', '24');
    ico.setAttribute('height', '24');
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', '12'); circ.setAttribute('cy', '12'); circ.setAttribute('r', '9');
    circ.setAttribute('fill', meta.color);
    circ.setAttribute('stroke', '#111');
    circ.setAttribute('stroke-width', '2');
    ico.appendChild(circ);

    // Name + blurb
    const txt = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = meta.name;
    title.style.fontWeight = '600';
    const blurb = document.createElement('div');
    blurb.textContent = meta.blurb;
    blurb.style.opacity = '0.85';
    blurb.style.fontSize = '12px';
    txt.appendChild(title);
    txt.appendChild(blurb);

    // Count pill
    const pill = document.createElement('div');
    pill.textContent = 'x ' + n;
    pill.style.background = '#1b2437';
    pill.style.border = '1px solid #2a3854';
    pill.style.borderRadius = '999px';
    pill.style.padding = '2px 8px';
    pill.style.fontWeight = '600';

    row.appendChild(ico);
    row.appendChild(txt);
    row.appendChild(pill);
    root.appendChild(row);
  });

  // Empty state
  if (!root.children.length) {
    const p = document.createElement('div');
    p.style.opacity = '0.7';
    p.textContent = 'No preview available.';
    root.appendChild(p);
  }
}


// ---------- Dev / Playtest Panel ----------
async function ensureDevPanel() {
  const rightCol = document.getElementById('rightCol');
  if (!rightCol) return;

  // Avoid duplicates if bindUI is ever called twice
  if (document.getElementById('devPanel')) return;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'devPanel';

  const title = document.createElement('div');
  title.className = 'pTitle';
  title.textContent = 'Dev / Playtest';
  panel.appendChild(title);

  const row = (node) => { const d = document.createElement('div'); d.style.margin = '6px 0'; d.appendChild(node); panel.appendChild(d); };

  // Infinite money checkbox
  const moneyWrap = document.createElement('label');
  moneyWrap.style.display = 'flex';
  moneyWrap.style.alignItems = 'center';
  moneyWrap.style.gap = '8px';
  const moneyCb = document.createElement('input');
  moneyCb.type = 'checkbox';
  moneyCb.checked = !!state.GameState.dev?.infiniteMoney;
  moneyCb.addEventListener('change', () => {
    state.GameState.dev = state.GameState.dev || {};
    state.GameState.dev.infiniteMoney = moneyCb.checked;
    if (moneyCb.checked) {
      state.GameState.gold  = 1_000_000;
      state.GameState.bones = 1_000_000;
      refreshHUD();
    }
  });
  const moneyLbl = document.createElement('span');
  moneyLbl.textContent = 'Infinite gold & bones';
  moneyWrap.appendChild(moneyCb);
  moneyWrap.appendChild(moneyLbl);
  row(moneyWrap);

  // Grant resources once
  const grantBtn = document.createElement('button');
  grantBtn.className = 'btn';
  grantBtn.textContent = 'Grant 1,000g + 1,000 bones';
  grantBtn.addEventListener('click', () => {
    state.GameState.gold  = (state.GameState.gold  | 0) + 1000;
    state.GameState.bones = (state.GameState.bones | 0) + 1000;
    refreshHUD();
  });
  row(grantBtn);

  // Spawn enemy buttons
  const spawnRow = document.createElement('div');
  spawnRow.style.display = 'grid';
  spawnRow.style.gridTemplateColumns = 'repeat(3, 1fr)';
  spawnRow.style.gap = '6px';

  const types = ['villager','squire','knight','hero','engineer','kingsguard','boss'];
  const combat = await getCombat();

  function addSpawnBtn(type) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `Spawn ${type}`;
    b.addEventListener('click', () => {
      if (typeof combat.devSpawnEnemy === 'function') {
        combat.devSpawnEnemy(state.GameState, type, 1);
        tell(`Spawned ${type}`);
      } else {
        tell('devSpawnEnemy not found in combat.js', '#f88');
      }
    });
    spawnRow.appendChild(b);
  }
  types.forEach(addSpawnBtn);
  row(spawnRow);

  // Utilities row
  const utilRow = document.createElement('div');
  utilRow.style.display = 'flex';
  utilRow.style.gap = '6px';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear Enemies';
  clearBtn.addEventListener('click', async () => {
    const c = await getCombat();
    if (typeof c.devClearEnemies === 'function') {
      c.devClearEnemies(state.GameState);
      tell('Cleared enemies');
    }
  });
  utilRow.appendChild(clearBtn);

  const logBtn = document.createElement('button');
  logBtn.className = 'btn';
  logBtn.textContent = 'Log Enemies';
  logBtn.addEventListener('click', async () => {
    const c = await getCombat();
    if (typeof c.debugEnemy === 'function') {
      console.group('Enemies');
      for (const e of state.GameState.enemies) {
        console.log(c.debugEnemy(e));
      }
      console.groupEnd();
      tell('Enemy debug logged to console');
    } else {
      tell('combat.debugEnemy not available', '#f88');
    }
  });
  utilRow.appendChild(logBtn);

  const setWaveBtn = document.createElement('button');
  setWaveBtn.className = 'btn';
  setWaveBtn.textContent = 'Set Wave…';
  setWaveBtn.addEventListener('click', () => {
    const n = parseInt(prompt('Set current wave number:', String(state.GameState.wave | 0)), 10);
    if (!Number.isNaN(n) && n > 0) {
      state.GameState.wave = n | 0;
      refreshHUD();
      tell(`Wave set to ${n}`);
    }
  });
  utilRow.appendChild(setWaveBtn);

  panel.appendChild(utilRow);

  rightCol.appendChild(panel);
}
