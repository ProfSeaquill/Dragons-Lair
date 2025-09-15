// ui.js — edge-wall build mode + HUD + Next Wave preview

import * as state from './state.js';
import { toggleEdge, recomputePath } from './pathing.js';
import { getUpgradeInfo, buyUpgrade } from './upgrades.js';

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
  buildHelp: (function(){
    const n = document.querySelector('.gridHelp');
    if (n) {
      n.textContent =
        'Build Mode: Click a TILE EDGE to add a wall (10 bones). Right-click an edge wall to remove (refund 5). Walls cannot fully block entry <-> exit.';
    }
    return n;
  })(),
};

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

  // Boot ok banner
  window.dispatchEvent(new CustomEvent('dl-boot-ok'));
}

// Track last values so we only rebuild when needed
let _lastPreviewWave = -1;
let _lastGold = -1;

export function refreshHUD() {
  const gs = state.GameState;
  const ds = state.getDragonStats(gs);

  if (hud.wave)  hud.wave.textContent  = String(gs.wave | 0);
  if (hud.gold)  hud.gold.textContent  = String(gs.gold | 0);
  if (hud.bones) hud.bones.textContent = String(gs.bones | 0);
  if (hud.hp)    hud.hp.textContent    = `${gs.dragonHP | 0}/${ds.maxHP | 0}`;
  if (hud.auto)  hud.auto.checked      = !!gs.autoStart;

  // Rebuild upgrade buttons when gold changes so disabled/enabled updates live
  if ((gs.gold | 0) !== _lastGold) {
    _lastGold = gs.gold | 0;
    renderUpgradesPanel();
  }

  // Only rebuild the Next Wave preview when the wave number changes
  if ((gs.wave | 0) !== _lastPreviewWave) {
    _lastPreviewWave = gs.wave | 0;
    renderNextWavePreview().catch(err => console.warn('preview failed:', err));
  }
}

// Lightweight message banner
function tell(s, color = '') {
  if (!hud.msg) return;
  hud.msg.textContent = String(s);
  hud.msg.style.color = color || '';
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
      const ds = state.getDragonStats(gs);
      if (gs.dragonHP >= ds.maxHP) { tell('HP already full'); return; }
      if (gs.bones <= 0) { tell('Not enough bones'); return; }
      // Heal: 1 HP per 1 bone
      const deficit = ds.maxHP - gs.dragonHP;
      const bonesToSpend = Math.min(gs.bones, deficit);
      gs.bones -= bonesToSpend;
      gs.dragonHP += bonesToSpend;
      refreshHUD();
      tell(`Healed ${bonesToSpend} HP`);
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
      gs.autoStart = !!e.target.checked;
      refreshHUD();
      tell(gs.autoStart ? 'Auto-start ON' : 'Auto-start OFF');
    });
  }

  if (hud.save) {
    hud.save.addEventListener('click', () => {
      if (state.saveState(gs)) tell('Saved', '#8f8');
      else tell('Save failed', '#f88');
    });
  }

  if (hud.load) {
    hud.load.addEventListener('click', () => {
      if (state.loadState()) {
        recomputePath(gs);
        refreshHUD();
        tell('Loaded', '#8f8');
      } else {
        tell('No save found', '#f88');
      }
    });
  }
}

// ---------- Upgrades panel ----------
function renderUpgradesPanel() {
  const root = hud.upgrades;
  if (!root) return;
  const infos = getUpgradeInfo(state.GameState);
  root.innerHTML = '';
  infos.forEach(info => {
    const row = document.createElement('div');
    row.className = 'uRow';
    const name = document.createElement('div');
    const btn = document.createElement('button');
    const small = document.createElement('small');

    name.textContent = `${info.title} (Lv ${info.level})`;
    small.textContent = info.desc || '';
    btn.className = 'btn';
    btn.textContent = `Buy ${info.cost}g`;
    btn.disabled = state.GameState.gold < info.cost;

    btn.addEventListener('click', () => {
      const ok = buyUpgrade(state.GameState, info.key);
      if (ok) {
        renderUpgradesPanel();
        refreshHUD();
        tell(`Upgraded ${info.title}`);
      } else {
        tell('Not enough gold');
      }
    });

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.appendChild(name);
    if (info.desc) left.appendChild(small);

    row.appendChild(left);
    row.appendChild(btn);
    root.appendChild(row);
  });
}

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

  cv.addEventListener('mousedown', (e) => {
    const hover = edgeHitTest(cv, e);
    if (!hover) return;

    const place = (e.button === 0);
    const remove = (e.button === 2);
    if (!place && !remove) return;

    const hasWall = edgeHasWall(state.GameState, hover.x, hover.y, hover.side);
    if (place && hasWall) return;
    if (remove && !hasWall) return;

    const res = toggleEdge(state.GameState, hover.x, hover.y, hover.side, place);
    if (!res.ok) {
      tell(`Blocked: ${res.reason || 'Action not allowed'}`, '#f88');
      return;
    }

    refreshHUD();
    const verb = place ? 'Placed' : 'Removed';
    const delta = place ? `(-${state.COSTS.edgeWall})` : `(+${state.COSTS.edgeRefund})`;
    tell(`${verb} wall ${delta}`, '#8f8');
  });
}

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

// ---------- Optional small API for main/render ----------
export const UI = { refreshHUD, tell };
