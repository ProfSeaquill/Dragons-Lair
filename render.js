// render.js — cave edge rendering + hover highlight + lightweight sprites

import * as state from './state.js';

/* -----------------------------------------------------------
 * DRAGON SPRITE (singleton loader)
 * --------------------------------------------------------- */
const dragonImg = new Image();
let dragonReady = false;
dragonImg.onload = () => { dragonReady = true; };
// Adjust the filename if yours differs
dragonImg.src = './assets/dragon_idle.png';


// --- Fire sprite sheet ---
const fireImg = new Image();
fireImg.src = './assets/fire_breath.png';
let fireReady = false;
fireImg.onload = () => { fireReady = true; };
/**
 * Public: draw the entire frame.
 * - Uses edge walls & distance field (no single precomputed path).
 * - Safe whether enemies use pixel (x,y) or cell (cx,cy) positions.
 */
export function draw(ctx, gs = state.GameState) {
  const { width, height } = ctx.canvas;

  // Keep pixels crisp for our hybrid chunky/pixel style
  ctx.imageSmoothingEnabled = false;

  // -------- Background
  ctx.clearRect(0, 0, width, height);
  fillRect(ctx, 0, 0, width, height, '#0e1526');

  // Optional: faint grid for readability
  drawFaintTiles(ctx);

  // -------- Entry / Exit markers
  drawEntryExit(ctx);

  // -------- Distance-field hints (subtle "flow" dots away from ENTRY)
  drawDistHints(ctx, gs);

  // -------- Cave edges (walls)
  drawEdgeWalls(ctx, gs);

  // -------- Hover edge highlight (from UI)
  drawHoverEdge(ctx, gs);

  // -------- Enemies / Dragon
  drawEnemies(ctx, gs);
  drawDragon(ctx, gs);

  // -------- Bombs (engineer)
  drawBombs(ctx, gs);
}

/* ===================== helpers ===================== */

function drawFaintTiles(ctx) {
  const t = state.GRID.tile;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= state.GRID.cols; x++) {
    const px = x * t + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, state.GRID.rows * t);
  }
  for (let y = 0; y <= state.GRID.rows; y++) {
    const py = y * t + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(state.GRID.cols * t, py);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEntryExit(ctx) {
  const ep = centerOf(state.ENTRY.x, state.ENTRY.y);
  const xp = centerOf(state.EXIT.x, state.EXIT.y);

  // ENTRY
  circle(ctx, ep.x, ep.y, state.GRID.tile * 0.28, '#0b4', true);
  ring(ctx, ep.x, ep.y, state.GRID.tile * 0.32, '#1f7');

  // EXIT / Dragon lair mouth (ring stays even with sprite)
  circle(ctx, xp.x, xp.y, state.GRID.tile * 0.28, '#844', true);
  ring(ctx, xp.x, xp.y, state.GRID.tile * 0.32, '#c88');
}

function drawEdgeWalls(ctx, gs) {
  const t = state.GRID.tile;
  ctx.save();
  ctx.strokeStyle = '#9fb4d8';
  ctx.lineWidth = Math.max(3, Math.floor(t * 0.12));
  ctx.lineCap = 'round';

  // Draw N & W for each cell; add E/S on last col/row to avoid double strokes.
  for (let y = 0; y < state.GRID.rows; y++) {
    for (let x = 0; x < state.GRID.cols; x++) {
      const rec = state.ensureCell(gs, x, y);
      const x0 = x * t, y0 = y * t, x1 = x0 + t, y1 = y0 + t;

      if (rec.N) seg(ctx, x0, y0, x1, y0);
      if (rec.W) seg(ctx, x0, y0, x0, y1);

      if (x === state.GRID.cols - 1 && rec.E) seg(ctx, x1, y0, x1, y1);
      if (y === state.GRID.rows - 1 && rec.S) seg(ctx, x0, y1, x1, y1);
    }
  }
  ctx.restore();
}

function drawHoverEdge(ctx, gs) {
  const hover = gs.uiHoverEdge;
  if (!hover) return;

  const t = state.GRID.tile;
  const x0 = hover.x * t;
  const y0 = hover.y * t;
  const x1 = x0 + t;
  const y1 = y0 + t;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(3, Math.floor(t * 0.14));
  ctx.lineCap = 'round';

  switch (hover.side) {
    case 'N': seg(ctx, x0, y0, x1, y0); break;
    case 'S': seg(ctx, x0, y1, x1, y1); break;
    case 'W': seg(ctx, x0, y0, x0, y1); break;
    case 'E': seg(ctx, x1, y0, x1, y1); break;
  }
  ctx.restore();
}

function drawDistHints(ctx, gs) {
  const t = state.GRID.tile;
  const dist = gs.distFromEntry;
  if (!dist) return;

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#8fb3ff';

  for (let y = 0; y < state.GRID.rows; y++) {
    for (let x = 0; x < state.GRID.cols; x++) {
      const d0 = dist?.[y]?.[x];
      if (!isFinite(d0)) continue;

      // Pick a neighbor with larger distance (moving "forward" from entry)
      let best = null, bestD = d0;
      const candidates = [
        [x + 1, y],
        [x, y + 1],
        [x - 1, y],
        [x, y - 1],
      ];
      for (const [nx, ny] of candidates) {
        if (!state.inBounds(nx, ny)) continue;
        const dn = dist?.[ny]?.[nx];
        if (isFinite(dn) && dn > bestD) { bestD = dn; best = { nx, ny }; }
      }
      if (!best) continue;

      const a = centerOf(x, y);
      const b = centerOf(best.nx, best.ny);
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = (dx / L) * (t * 0.22);
      const uy = (dy / L) * (t * 0.22);

      circle(ctx, a.x + ux, a.y + uy, Math.max(2, t * 0.06), '#8fb3ff', true);
    }
  }

  ctx.restore();
}

function drawEnemies(ctx, gs) {
  if (!Array.isArray(gs.enemies)) return;
  const r = Math.max(3, state.GRID.tile * 0.22);

  for (const e of gs.enemies) {
    const p = enemyPixelPosition(e);
    if (!p) continue;

    const fill = colorForEnemy(e);
    circle(ctx, p.x, p.y, r, fill, true);

    // Visual accents
    if (e?.shield)   ring(ctx, p.x, p.y, r + 2, '#9df'); // hero’s shield ring
    if (e?.miniboss) ring(ctx, p.x, p.y, r + 5, '#f7a'); // miniboss halo
  }
}

// Map enemy types to colors (mirrors UI preview colors)
const ENEMY_COLORS = {
  villager:   '#9acd32',
  squire:     '#7fd1ff',
  knight:     '#ffd166',
  hero:       '#ff6b6b',
  engineer:   '#c084fc',
  kingsguard: '#ffa8a8',
  boss:       '#f4a261',
};

function colorForEnemy(e) {
  if (e && typeof e.color === 'string') return e.color;
  if (e && ENEMY_COLORS[e.type]) return ENEMY_COLORS[e.type];
  return e?.shield ? '#5cf' : '#fc3';
}

function drawDragon(ctx, gs) {
  const p = centerOf(state.EXIT.x, state.EXIT.y);

  // Choose a size that reads well on your grid; tweak as needed.
  // ~2 tiles wide keeps it chunky but readable.
  const size = Math.round(state.GRID.tile * 2);
  const half = size / 2;

  if (dragonReady) {
    ctx.drawImage(dragonImg, p.x - half, p.y - half, size, size);
  } else {
    // Fallback while the sprite is still loading
    const r = Math.max(6, state.GRID.tile * 0.35);
    circle(ctx, p.x, p.y, r, '#b33', true);
  }

  // Lair accent ring (kept from your original)
  const r = Math.max(6, state.GRID.tile * 0.35);
}

/* ===================== tiny primitives ===================== */

function centerOf(cx, cy) {
  return {
    x: cx * state.GRID.tile + state.GRID.tile / 2,
    y: cy * state.GRID.tile + state.GRID.tile / 2,
  };
}

function seg(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 + 0.5);
  ctx.lineTo(x1 + 0.5, y1 + 0.5);
  ctx.stroke();
}

function ring(ctx, x, y, r, strokeStyle = '#fff') {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function circle(ctx, x, y, r, fillStyle = '#fff', filled = true) {
  ctx.save();
  if (filled) ctx.fillStyle = fillStyle; else ctx.strokeStyle = fillStyle;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  filled ? ctx.fill() : ctx.stroke();
  ctx.restore();
}

function fillRect(ctx, x, y, w, h, fillStyle) {
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawBombs(ctx, gs) {
  if (!Array.isArray(gs.effects)) return;
  const t = state.GRID.tile;
  for (const fx of gs.effects) {
    if (fx.type !== 'bomb') continue;
    const r = Math.max(6, t * 0.22);
    // Pulse as timer counts down
    const pulse = 0.5 + 0.5 * Math.sin((fx.timer || 0) * 6.283);
    circle(ctx, fx.x, fx.y, r * (0.9 + 0.2 * pulse), '#f44', true);
    ring(ctx, fx.x, fy = fx.y, r + 4, '#faa');
    // Tiny timer text
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(8, (t * 0.28) | 0)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(Math.max(0, fx.timer)).toString(), fx.x, fx.y);
    ctx.restore();
  }
}

/* ===================== position helpers ===================== */

function enemyPixelPosition(e) {
  if (typeof e.x === 'number' && typeof e.y === 'number') {
    return { x: e.x, y: e.y };
  }
  if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
    return centerOf(e.cx, e.cy);
  }
  return null;
}
