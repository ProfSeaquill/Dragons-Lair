// render.js — draw grid, path, dragon, enemies, and breath zone
// Compatible with the revised state.js (no GameState singleton).
// Expected to be called as draw(ctx, gs) from main.js.

import { GRID, getDragonStats } from './state.js';

// --- Internal helpers ---
function getCanvas() {
  return /** @type {HTMLCanvasElement|null} */ (document.getElementById('game'));
}
function getCtx() {
  const c = getCanvas();
  return c ? c.getContext('2d') : null;
}
function tileCenter(x, y) {
  return {
    cx: x * GRID.TILE + GRID.TILE / 2,
    cy: y * GRID.TILE + GRID.TILE / 2,
  };
}
function normNode(p) {
  // Support either {x,y} or {c,r}
  const x = (p && (p.x ?? p.c)) | 0;
  const y = (p && (p.y ?? p.r)) | 0;
  return { x, y };
}
function enemyColor(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'villager')   return '#b3c1d1';
  if (t === 'squire')     return '#92a7ff';
  if (t === 'hero')       return '#ffd76a';
  if (t === 'knight')     return '#8dd18d';
  if (t === 'kingsguard') return '#ff7e7e';
  if (t === 'engineer')   return '#ffad66';
  return '#ddd';
}
function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < (GRID?.W ?? 24) && y < (GRID?.H ?? 16);
}

// Try to infer ENTRY/EXIT from the path; fall back to edges if no path yet.
function computeEntryExit(gs) {
  const W = GRID.W, H = GRID.H;
  if (Array.isArray(gs?.path) && gs.path.length > 0) {
    const a = normNode(gs.path[0]);
    const b = normNode(gs.path[gs.path.length - 1]);
    return { entry: a, exit: b };
  }
  // Defaults: entry left-middle, exit right-middle
  return {
    entry: { x: 0,      y: Math.floor(H / 2) },
    exit:  { x: W - 1,  y: Math.floor(H / 2) },
  };
}

// --- Public: draw ---
export function draw(providedCtx, gs) {
  const c = getCanvas();
  const g = providedCtx || getCtx();
  if (!c || !g || !gs) return;

  const W = GRID.W, H = GRID.H, T = GRID.TILE;

  // Clear
  g.clearRect(0, 0, c.width, c.height);

  // Grid background (empty vs wall)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hasWall = gs.walls?.has?.(`${x},${y}`) ?? false;
      g.fillStyle = hasWall ? '#1c253b' : '#0c1222';
      g.fillRect(x * T, y * T, T - 1, T - 1);
    }
  }

  // Path highlight
  if (Array.isArray(gs.path)) {
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (const p of gs.path) {
      const n = normNode(p);
      if (!inBounds(n.x, n.y)) continue;
      g.fillRect(n.x * T, n.y * T, T - 1, T - 1);
    }
  }

  // Entry / Exit tiles
  const { entry, exit } = computeEntryExit(gs);
  if (inBounds(entry.x, entry.y)) {
    g.fillStyle = '#3aa675';
    g.fillRect(entry.x * T, entry.y * T, T - 1, T - 1);
  }
  if (inBounds(exit.x, exit.y)) {
    g.fillStyle = '#a63a3a';
    g.fillRect(exit.x * T, exit.y * T, T - 1, T - 1);
  }

  // Dragon (draw at EXIT)
  if (inBounds(exit.x, exit.y)) {
    const { cx, cy } = tileCenter(exit.x, exit.y);
    g.fillStyle = '#e46e2e';
    g.beginPath();
    g.arc(cx, cy, T * 0.35, 0, Math.PI * 2);
    g.fill();
  }

  // Enemies
  if (Array.isArray(gs.enemies)) {
    for (const e of gs.enemies) {
      if (!e || e.hp <= 0) continue;

      // Position: prefer explicit (px) or (grid); fallback via pathIndex → path node center
      let cx, cy;

      if (typeof e.px === 'number' && typeof e.py === 'number') {
        cx = e.px; cy = e.py;
      } else if (typeof e.x === 'number' && typeof e.y === 'number') {
        ({ cx, cy } = tileCenter(e.x, e.y));
      } else if (Number.isFinite(e.pathIndex) && Array.isArray(gs.path) && gs.path.length > 0) {
        const idx = Math.max(0, Math.min(gs.path.length - 1, e.pathIndex | 0));
        const n = normNode(gs.path[idx]);
        ({ cx, cy } = tileCenter(n.x, n.y));
      } else {
        // No position info; skip drawing
        continue;
      }

      // Body
      g.fillStyle = enemyColor(e.type);
      g.beginPath();
      g.arc(cx, cy, T * 0.25, 0, Math.PI * 2);
      g.fill();

      // Health bar
      const maxHP = e.maxHP ?? e.hpMax ?? e.maxHp ?? e.hp;
      if (maxHP > 0) {
        const w = 32, h = 5;
        g.fillStyle = '#400';
        g.fillRect(cx - w / 2, cy - (T * 0.25 + 10), w, h);
        g.fillStyle = '#e44';
        g.fillRect(cx - w / 2, cy - (T * 0.25 + 10), Math.max(0, w * (e.hp / maxHP)), h);
      }

      // Special effects
      // Hero shield
      if (String(e.type).toLowerCase() === 'hero' && (e.shieldUp === true)) {
        g.strokeStyle = 'rgba(255, 235, 120, 0.8)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, T * 0.30, 0, Math.PI * 2);
        g.stroke();
      }
      // Burning aura
      const burningT = (e.burning && typeof e.burning.t === 'number') ? e.burning.t : (e.burning | 0);
      if (burningT > 0) {
        g.strokeStyle = 'rgba(255, 120, 50, 0.7)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, T * 0.33, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  // Breath visualization — highlight tiles within reach in front of the pack
  const ds = getDragonStats(gs);
  const reachTiles = ds?.reachTiles ?? ds?.reach ?? 0;

  if (Array.isArray(gs.path) && gs.path.length > 0 && reachTiles > 0) {
    // Find the front-most path index among active enemies
    let front = 0;
    for (const e of gs.enemies || []) {
      if (Number.isFinite(e?.pathIndex)) {
        front = Math.max(front, e.pathIndex | 0);
      }
    }
    front = Math.min(front, gs.path.length - 1);

    const start = Math.max(0, front - reachTiles + 1);
    g.fillStyle = 'rgba(255,120,50,0.15)';
    for (let i = start; i <= front; i++) {
      const n = normNode(gs.path[i]);
      if (!inBounds(n.x, n.y)) continue;
      g.fillRect(n.x * T, n.y * T, T - 1, T - 1);
    }
  }
}
