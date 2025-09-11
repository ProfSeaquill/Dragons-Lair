// ui.js — UI wiring, HUD rendering, wave preview, and build-mode controls

import { GRID, ECON } from './state.js';           // expects { W, H, TILE } and wall costs
import * as state from './state.js';                // optional: save/load, getDragonStats()
import * as scaling from './scaling.js';            // waveComposition(wave) for preview
import * as pathing from './pathing.js';            // toggleWall(gs,x,y,place), recomputePath(gs)
import * as upgrades from './upgrades.js';          // upgrade panel builder

// --- Local helpers ---
const $ = (id) => /** @type {HTMLElement|null} */ (document.getElementById(id));

let lastToastId = 0;
function setText(id, v) { const el = $(id); if (el) el.textContent = String(v); }

function canvasToGrid(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);

  // Tile size: infer if not provided
  const tileW = (typeof GRID?.TILE === 'number' && GRID.TILE > 0)
    ? GRID.TILE
    : Math.floor(canvas.width / (GRID?.W || 24)); // default 24 cols
  const tileH = (typeof GRID?.TILE === 'number' && GRID.TILE > 0)
    ? GRID.TILE
    : Math.floor(canvas.height / (GRID?.H || 16)); // default 16 rows

  const gx = Math.floor(x / tileW);
  const gy = Math.floor(y / tileH);
  return { gx, gy };
}

// --- Public: toast ---
export function toast(msg, ms = 1400) {
  const el = $('msg');
  if (!el) return;
  const myId = ++lastToastId;
  el.textContent = String(msg);
  el.style.opacity = '1';
  setTimeout(() => {
    if (myId === lastToastId) {
      el.style.opacity = '.0';
      // delay clearing text a bit so fade-out looks nicer
      setTimeout(() => { if (myId === lastToastId) el.textContent = ''; }, 250);
    }
  }, ms);
}

// --- Public: bind UI once ---
export function bindUI(gs) {
  // Auto-start checkbox
  const auto = /** @type {HTMLInputElement|null} */ ($('autoStart'));
  if (auto) {
    auto.checked = !!gs.autoStart;
    auto.addEventListener('change', () => {
      gs.autoStart = !!auto.checked;
      toast(gs.autoStart ? 'Auto-start: ON' : 'Auto-start: OFF', 900);
    });
  }

  // Save / Load (defensive: only if state exposes these)
  const saveBtn = $('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    if (typeof state.save === 'function') { state.save(gs); toast('Saved'); }
    else toast('Save not available', 900);
  });

  const loadBtn = $('loadBtn');
  if (loadBtn) loadBtn.addEventListener('click', () => {
    if (typeof state.load === 'function') { state.load(gs); toast('Loaded'); }
    else toast('Load not available', 900);
  });

  // Build-mode canvas controls
  const canvas = /** @type {HTMLCanvasElement|null} */ ($('game'));
  if (canvas) {
    // Left click: place wall (cost handled in toggleWall/pathing)
    canvas.addEventListener('click', (e) => {
      if (gs.mode !== 'build') return;
      const { gx, gy } = canvasToGrid(canvas, e.clientX, e.clientY);
      if (!inBounds(gx, gy)) return;

      const placed = tryToggleWall(gs, gx, gy, true);
      if (placed === 'blocked') toast('Placement would block path', 1000);
      else if (placed === 'no-bones') toast(`Not enough bones (${ECON.WALL_COST})`, 1000);
      else if (placed === 'ok') toast('Wall placed', 650);
      else if (placed === 'occupied') toast('Tile already a wall', 900);
    });

    // Right click: remove wall (refund handled in toggleWall/pathing)
    canvas.addEventListener('contextmenu', (e) => {
      if (gs.mode !== 'build') return;
      e.preventDefault();
      const { gx, gy } = canvasToGrid(canvas, e.clientX, e.clientY);
      if (!inBounds(gx, gy)) return;

      const removed = tryToggleWall(gs, gx, gy, false);
      if (removed === 'ok') toast(`Wall removed (+${ECON.WALL_REFUND})`, 650);
      else if (removed === 'empty') toast('No wall here', 900);
    });
  }

  // Upgrades panel
  renderUpgrades(gs);
}

function inBounds(x, y) {
  const W = GRID?.W ?? 24;
  const H = GRID?.H ?? 16;
  return x >= 0 && y >= 0 && x < W && y < H;
}

function tryToggleWall(gs, gx, gy, place) {
  // Expectation: pathing.toggleWall(gs, gx, gy, place) returns one of:
  // 'ok' | 'blocked' | 'no-bones' | 'occupied' | 'empty'
  if (typeof pathing.toggleWall === 'function') {
    const res = pathing.toggleWall(gs, gx, gy, place);
    // If toggle succeeded, recompute path (some implementations do this internally)
    if (res === 'ok' && typeof pathing.recomputePath === 'function') {
      pathing.recomputePath(gs);
    }
    return res;
  }

  // Fallback no-op if pathing not ready
  return 'blocked';
}

// --- Public: HUD/UI refresh (cheap, safe to call every frame) ---
export function renderUI(gs) {
  setText('wave', gs.wave ?? 1);
  setText('dragonHP', Math.ceil(gs.dragon?.hp ?? 100));
  setText('gold', Math.floor(gs.gold ?? 0));
  if (typeof gs._uiLastGold !== 'number' || gs._uiLastGold !== (gs.gold|0)) {
    gs._uiLastGold = (gs.gold|0);
    const box = document.getElementById('upgrades');
    if (box && typeof upgrades.renderUpgrades === 'function') {
      upgrades.renderUpgrades(gs, box, { toast });
    }
  }
  setText('bones', Math.floor(gs.bones ?? 0));

  // Keep Auto-start checkbox in sync if toggled programmatically
  const auto = /** @type {HTMLInputElement|null} */ ($('autoStart'));
  if (auto && auto.checked !== !!gs.autoStart) auto.checked = !!gs.autoStart;
}

// --- Public: wave preview panel ---
export function previewNextWave(gs) {
  const el = $('preview');
  if (!el) return;
  el.innerHTML = '';

  if (typeof scaling.waveComposition !== 'function') {
    el.textContent = 'Wave data unavailable';
    return;
  }

  const comp = scaling.waveComposition(gs.wave ?? 1, gs); // allow (wave, gs)
  if (!comp || (Array.isArray(comp) && comp.length === 0)) {
    el.textContent = '—';
    return;
  }

  // Normalize composition to an array of { type, count }
  const list = Array.isArray(comp)
    ? comp
    : Object.entries(comp).map(([type, count]) => ({ type, count }));

  const frag = document.createDocumentFragment();
  list.forEach(({ type, count }) => {
    const row = document.createElement('div');
    row.className = 'uRow';
    const name = document.createElement('div');
    name.textContent = prettyName(type);
    const qty = document.createElement('small');
    qty.textContent = `x${count}`;
    row.appendChild(name);
    row.appendChild(qty);
    frag.appendChild(row);
  });
  el.appendChild(frag);
}

// --- Upgrades rendering (optional; guarded) ---
function renderUpgrades(gs) {
  const box = $('upgrades');
  if (!box) return;

  if (typeof upgrades.renderUpgrades === 'function') {
    upgrades.renderUpgrades(gs, box, { toast });
    return;
  }

  // Otherwise, show a minimal hint so the panel isn't empty
  box.innerHTML = `<div style="opacity:.8;font-size:12px">Upgrades UI provided by <code>upgrades.js</code>.</div>`;
}

function prettyName(type) {
  if (!type) return 'Unknown';
  const raw = String(type);

  // Boss prettifier: 'boss:Lancelot' → 'Lancelot', 'boss:Arthur' → 'King Arthur'
  if (raw.startsWith('boss:')) {
    const name = raw.split(':')[1] || 'Boss';
    return name === 'Arthur' ? 'King Arthur' : name;
  }

  // Simple prettifier: "kingsguard" -> "Kingsguard", "squire_fast" -> "Squire Fast"
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
