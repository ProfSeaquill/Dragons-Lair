// ui.js — edge-wall build mode + HUD wiring

import * as state from './state.js';


import {
  toggleEdge, recomputePath
} from './pathing.js';

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
        'Build Mode: Click a TILE EDGE to add a wall (10 bones). Right-click an edge wall to remove (refund 5). Walls cannot fully block entry ↔ exit.';
    }
    return n;
  })(),
};

// For render.js (optional): we expose a hover highlight for edges
GameState.uiHoverEdge = null;  // {x,y,side} or null

// ---------- Public API ----------
export function bindUI() {
  wireButtons();
  wireCanvasEdgeBuild();
  renderUpgradesPanel();
  refreshHUD();
  // Recompute distance field once (safe even if already called in main)
  recomputePath(GameState);

  // Tell boot overlay we're good
  window.dispatchEvent(new CustomEvent('dl-boot-ok'));
}

// Call when amounts change (gold/bones/HP/wave etc.)
export function refreshHUD() {
  const gs = GameState;
  const ds = getDragonStats(gs);
  if (hud.wave)  hud.wave.textContent  = String(gs.wave | 0);
  if (hud.gold)  hud.gold.textContent  = String(gs.gold | 0);
  if (hud.bones) hud.bones.textContent = String(gs.bones | 0);
  if (hud.hp)    hud.hp.textContent    = `${gs.dragonHP | 0}/${ds.maxHP | 0}`;
  if (hud.auto)  hud.auto.checked      = !!gs.autoStart;
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
  const gs = GameState;

  if (hud.healBtn) {
    hud.healBtn.addEventListener('click', () => {
      const ds = getDragonStats(gs);
      if (gs.dragonHP >= ds.maxHP) { tell('HP already full'); return; }
      if (gs.bones <= 0) { tell('Not enough bones'); return; }
      // Heal: 1 HP per 1 bone (COSTS.healPerBone)
      const deficit = ds.maxHP - gs.dragonHP;
      const possible = Math.min(deficit, Math.max(0, gs.bones * COSTS.healPerBone));
      const bonesToSpend = Math.ceil(possible / COSTS.healPerBone);
      gs.bones -= bonesToSpend;
      gs.dragonHP = Math.min(ds.maxHP, gs.dragonHP + bonesToSpend * COSTS.healPerBone);
      refreshHUD();
      tell(`Healed ${bonesToSpend} HP`);
    });
  }

  if (hud.start) {
    hud.start.addEventListener('click', () => {
      // Fire a custom event so main/combat can listen without tight coupling
      window.dispatchEvent(new CustomEvent('dl-start-wave'));
      tell('Wave starting…');
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
      if (saveState(gs)) tell('Saved', '#8f8');
      else tell('Save failed', '#f88');
    });
  }

  if (hud.load) {
    hud.load.addEventListener('click', () => {
      if (loadState()) {
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
  const infos = getUpgradeInfo(GameState);
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
    btn.disabled = GameState.gold < info.cost;

    btn.addEventListener('click', () => {
      const ok = buyUpgrade(GameState, info.key);
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
    GameState.uiHoverEdge = hover; // for render highlight
    // Optional tiny tooltip via msg:
    if (hover) {
      const hasWall = edgeHasWall(GameState, hover.x, hover.y, hover.side);
      const verb = hasWall ? 'Remove' : 'Place';
      const cost = hasWall ? `(+${COSTS.edgeRefund} bones)` : `(${COSTS.edgeWall} bones)`;
      tell(`${verb} wall: (${hover.x},${hover.y}) ${hover.side} ${cost}`, '#9cf');
    } else if (hud.msg && hud.msg.textContent && hud.msg.textContent.startsWith('Place wall:')) {
      // clear soft msg
      hud.msg.textContent = '';
    }
  });

  cv.addEventListener('mouseleave', () => {
    GameState.uiHoverEdge = null;
  });

  cv.addEventListener('mousedown', (e) => {
    const hover = edgeHitTest(cv, e);
    if (!hover) return;

    const place = (e.button === 0);         // left = place
    const remove = (e.button === 2);        // right = remove
    if (!place && !remove) return;

    const hasWall = edgeHasWall(GameState, hover.x, hover.y, hover.side);

    // If attempting to place but it already exists, ignore; likewise remove if none
    if (place && hasWall) return;
    if (remove && !hasWall) return;

    const res = toggleEdge(GameState, hover.x, hover.y, hover.side, place);
    if (!res.ok) {
      tell(`❌ ${res.reason || 'Action blocked'}`, '#f88');
      return;
    }

    refreshHUD();
    const verb = place ? 'Placed' : 'Removed';
    const delta = place ? `(-${COSTS.edgeWall})` : `(+${COSTS.edgeRefund})`;
    tell(`${verb} wall ${delta}`, place ? '#8f8' : '#8f8');
  });
}

// Returns {x,y,side} or null
function edgeHitTest(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (evt.clientX - rect.left) * scaleX;
  const my = (evt.clientY - rect.top) * scaleY;

  const t = GRID.tile;
  const cx = Math.floor(mx / t);
  const cy = Math.floor(my / t);
  if (!inBounds(cx, cy)) return null;

  const lx = mx - cx * t; // local x within tile
  const ly = my - cy * t; // local y within tile
  const edgePad = Math.max(4, Math.floor(t * 0.12)); // clickable region thickness

  // Determine closest edge if within pad
  let side = null, dist = Infinity;

  // Top (N)
  const dN = ly;
  if (dN <= edgePad && dN < dist) { side = 'N'; dist = dN; }

  // Bottom (S)
  const dS = t - ly;
  if (dS <= edgePad && dS < dist) { side = 'S'; dist = dS; }

  // Left (W)
  const dW = lx;
  if (dW <= edgePad && dW < dist) { side = 'W'; dist = dW; }

  // Right (E)
  const dE = t - lx;
  if (dE <= edgePad && dE < dist) { side = 'E'; dist = dE; }

  if (!side) return null;
  return { x: cx, y: cy, side };
}

function edgeHasWall(gs, x, y, side) {
  const rec = ensureCell(gs, x, y);
  return !!rec?.[side];
}

// Optional: expose a tiny API for main/render to update HUD externally
export const UI = { refreshHUD, tell };
