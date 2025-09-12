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
function isBossType(t) { return typeof t === 'string' && t.startsWith('boss:'); }
function bossName(t) { return isBossType(t) ? t.split(':')[1] : null; }

function enemyColor(type) {
  // Handle bosses first (don't lowercase away the prefix)
  if (isBossType(type)) return '#ff66cc'; // distinct magenta for bosses
  const t = String(type || '').toLowerCase();
  if (t === 'villager')   return '#ffffff';
  if (t === 'squire')     return '#00c853';
  if (t === 'hero')       return '#8fd3ff';
  if (t === 'knight')     return '#8b5a2b';
  if (t === 'kingsguard') return '#9b59ff';
  if (t === 'engineer')   return '#ffd54f';
  return '#ddd';
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < (GRID?.W ?? 24) && y < (GRID?.H ?? 16);
}

function drawClawFx(g, gs, exit, T) {
  const fxArr = gs.fx?.claw || [];
  for (const fx of fxArr) {
    const life = Math.max(0, Math.min(1, fx.ttl / 0.25)); // 0..1
    const alpha = 0.15 + 0.35 * life;
    const radius = T * (0.55 + 0.25 * (1 - life));
    const start = -Math.PI * (0.35 + 0.15 * (1 - life));
    const end   =  Math.PI * (0.35 + 0.15 * (1 - life));
    g.strokeStyle = `rgba(255,140,80,${alpha})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(exit.cx, exit.cy, radius, start, end);
    g.stroke();
  }
}

function drawWingFx(g, gs, exit, T) {
  const fxArr = gs.fx?.wing || [];
  for (const fx of fxArr) {
    const life = Math.max(0, Math.min(1, fx.ttl / 0.35)); // 0..1
    const alpha = 0.10 + 0.25 * life;
    const tiles = (fx.strength || 1);
    const widthTiles = 3; // visual width of gust
    const w = widthTiles * T;
    const h = (tiles * T) * (0.8 + 0.2 * life);

    // rectangular gust pointing "away" from exit along negative X (left)
    g.save();
    g.translate(exit.cx, exit.cy);
    g.fillStyle = `rgba(180,220,255,${alpha})`;
    g.beginPath();
    g.rect(-h, -w / 2, h, w);
    g.fill();

    // a few streak lines
    g.strokeStyle = `rgba(220,240,255,${alpha + 0.05})`;
    g.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(-h, i * (w / 4));
      g.lineTo(-h * 0.2, i * (w / 4));
      g.stroke();
    }
    g.restore();
  }
}

function drawNameplate(g, text, x, y) {
  if (!text) return;
  g.save();
  g.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const pad = 4;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  const h = 16;
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(x - w / 2, y - 28, w, h);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y - 20);
  g.restore();
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

  // FX at dragon location
  const exitCenter = tileCenter(exit.x, exit.y);
  drawClawFx(g, gs, exitCenter, T);
  drawWingFx(g, gs, exitCenter, T);

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

      const isBoss = isBossType(e.type);
      const name = isBoss ? (bossName(e.type) === 'Arthur' ? 'King Arthur' : bossName(e.type)) : null;

      // Body (burrowed engineers drawn semi-ghosted with dashed halo)
      const baseColor = enemyColor(e.type);
      if (e.isBurrowing) {
        g.save();
        g.globalAlpha = 0.45;
        g.fillStyle = baseColor;
        g.beginPath();
        g.arc(cx, cy, T * 0.25, 0, Math.PI * 2);
        g.fill();
        g.setLineDash([4, 3]);
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(cx, cy, T * 0.28, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else {
        g.fillStyle = baseColor;
        g.beginPath();
        g.arc(cx, cy, T * 0.25, 0, Math.PI * 2);
        g.fill();
      }

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

      // Nameplate for bosses (Lancelot, etc., and King Arthur)
      if (isBoss && name) {
        drawNameplate(g, name, cx, cy);
      }
    }
  }

  // Breath visualization — highlight the last N tiles from the dragon
  {
    const ds = getDragonStats(gs);
    const reachTiles = (ds && typeof ds.reachTiles === 'number') ? ds.reachTiles : ((ds && ds.reach) || 0);

    if (Array.isArray(gs.path) && gs.path.length > 0 && reachTiles > 0) {
      const endIdx = Math.max(0, gs.path.length - 2); // adjacent tile
      const startIdx = Math.max(0, endIdx - reachTiles + 1);

      g.fillStyle = 'rgba(255,120,50,0.15)';
      for (let i = startIdx; i <= endIdx; i++) {
        const n = normNode(gs.path[i]);
        if (!inBounds(n.x, n.y)) continue;
        g.fillRect(n.x * T, n.y * T, T - 1, T - 1);
      }
    }
  }
} // ← end of draw()
