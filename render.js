// render.js — cave edge rendering + hover highlight + lightweight sprites

import * as state from './state.js';

/* -----------------------------------------------------------
 * DRAGON SPRITE (singleton loader)
 * --------------------------------------------------------- */
const dragonImg = new Image();
let dragonReady = false;
dragonImg.onload = () => { dragonReady = true; };
dragonImg.src = './assets/dragon_idle.png';

/* -----------------------------------------------------------
 * FIRE (mouth) — sprite sheet animation
 * --------------------------------------------------------- */
const fireImg = new Image();
let fireReady = false;
const FIRE_FRAMES = 12; // set to your sheet's frame count
fireImg.onload = () => { fireReady = true; };
fireImg.src = './assets/fire_breath.png'; // 12 frames wide, 1 row

/* -----------------------------------------------------------
 * FLAME STRIPS (corridor fire) — optional textures
 * --------------------------------------------------------- */
const fireStripH = new Image();
const fireStripV = new Image();
let fireHReady = false, fireVReady = false;
fireStripH.onload = () => (fireHReady = true);
fireStripV.onload = () => (fireVReady = true);
// fireStripH.src = './assets/fire_strip_h.png';
// fireStripV.src = './assets/fire_strip_v.png';

/* -----------------------------------------------------------
 * Enemy type colors
 * --------------------------------------------------------- */
const TYPE_COLOR = {
  villager:  '#9acd32',
  squire:    '#7fd1ff',
  knight:    '#ffd166',
  hero:      '#ff6b6b',
  engineer:  '#c084fc',
  kingsguard:'#ffa8a8',
  boss:      '#f4a261',
};

/**
 * Public: draw the entire frame.
 */
export function draw(ctx, gs = state.GameState) {
  const { width, height } = ctx.canvas;

  ctx.imageSmoothingEnabled = false;

  // -------- Background
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0e1526';
  ctx.fillRect(0, 0, width, height);

  // -------- Grid (faint)
  drawFaintTiles(ctx);

  // -------- Entry / Exit markers
  drawEntryExit(ctx);

  // -------- Distance-field hints
  drawDistHints(ctx, gs);

  // -------- Cave edges (walls)
  drawEdgeWalls(ctx, gs);

  // -------- Hover edge highlight (from UI)
  drawHoverEdge(ctx, gs);

  // -------- Enemies / Dragon
  drawEnemies(ctx, gs);
  drawDragon(ctx, gs);

  // -------- Corridor fire (traveling flame)
  drawFlameWaves(ctx, gs);

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
  // ENTRY only (keep it green)
  circle(ctx, ep.x, ep.y, state.GRID.tile * 0.28, '#0b4', true);
  ring(ctx, ep.x, ep.y, state.GRID.tile * 0.32, '#1f7');

  // No EXIT marker — the dragon sprite is the only thing at exit now
}

function drawEdgeWalls(ctx, gs) {
  const t = state.GRID.tile;
  ctx.save();
  ctx.strokeStyle = '#9fb4d8';
  ctx.lineWidth = Math.max(3, Math.floor(t * 0.12));
  ctx.lineCap = 'round';

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

      // choose neighbor with larger distance (moving "forward" from entry)
      let best = null, bestD = d0;
      const candidates = [
        [x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1],
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
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  for (const e of gs.enemies) {
    const p = enemyPixelPosition(e);
    if (!p) continue;

    // body color by type (heroes also get a ring)
    const bodyColor = TYPE_COLOR[e.type] || (e?.shield ? '#5cf' : '#fc3');
    circle(ctx, p.x, p.y, r, bodyColor, true);
    if (e?.shield)   ring(ctx, p.x, p.y, r + 2, '#9df');
    if (e?.miniboss) ring(ctx, p.x, p.y, r + 5, '#f7a');

    // conditional HP bar (only after recent damage)
    if (e.showHpUntil && now < e.showHpUntil && e.maxHp > 0) {
      const t = state.GRID.tile;
      const barW = Math.max(18, t * 0.8);
      const barH = Math.max(3,  t * 0.10);
      const x = p.x - barW / 2;
      const y = p.y - r - 6 - barH;

      const life = Math.max(0, e.showHpUntil - now) / 1000; // 0..1s
      const alpha = Math.min(1, life * 1.2);

      const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
      ctx.save();
      ctx.globalAlpha = alpha;

      // back
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y, barW, barH);

      // front
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(x + 1, y + 1, (barW - 2) * ratio, barH - 2);

      ctx.restore();
    }
  }
}

function drawDragon(ctx, gs) {
  const p = centerOf(state.EXIT.x, state.EXIT.y);
  const size = Math.round(state.GRID.tile * 2);
  const half = size / 2;

  // Dragon sprite
  if (dragonReady) {
    ctx.drawImage(dragonImg, p.x - half, p.y - half, size, size);
  }

  // Mouth fire overlay (while attacking)
  const fx = gs.dragonFX;
  if (fx && fx.attacking && fireReady) {
    const fw = fireImg.width / FIRE_FRAMES;
    const fh = fireImg.height;

    const progress = Math.min(1, fx.t / Math.max(0.001, fx.dur));
    const frame = Math.floor(progress * (FIRE_FRAMES - 1));

    const mouthX = p.x + Math.round(state.GRID.tile * 0.6);
    const mouthY = p.y - Math.round(state.GRID.tile * 0.15);

    ctx.drawImage(
      fireImg,
      frame * fw, 0, fw, fh,             // source rect
      mouthX, mouthY - fh / 2, fw, fh    // dest near mouth
    );
  }
}

/* -------- Traveling corridor fire -------- */
function drawFlameWaves(ctx, gs) {
  const tsize = state.GRID.tile;
  const waves = gs.effects || [];
  const tailLen = 10; // tiles that remain lit behind the head

  for (const fx of waves) {
    if (fx.type !== 'flameWave' || !fx.path || fx.headIdx == null) continue;

    const start = Math.max(0, fx.headIdx - tailLen);
    const end   = fx.headIdx;

    for (let i = start; i <= end; i++) {
      const seg = fx.path[i];
      if (!seg) continue;
      const c = centerOf(seg.x, seg.y);
      const age = end - i;                         // 0 = freshest
      const alpha = Math.max(0, 1 - age / tailLen);

      const horiz = (seg.from === 'E' || seg.from === 'W');
      const w = horiz ? tsize : (fx.widthPx || tsize * 0.9);
      const h = horiz ? (fx.widthPx || tsize * 0.9) : tsize;

      ctx.save();
      ctx.globalAlpha = alpha * 0.95;

      if (horiz && fireHReady) {
        ctx.drawImage(fireStripH, c.x - w/2, c.y - h/2, w, h);
      } else if (!horiz && fireVReady) {
        ctx.drawImage(fireStripV, c.x - w/2, c.y - h/2, w, h);
      } else {
        // Fallback: soft rounded “flame segment”
        const grd = ctx.createLinearGradient(c.x - w/2, c.y, c.x + w/2, c.y);
        grd.addColorStop(0.00, 'rgba(255,255,255,0.85)');
        grd.addColorStop(0.25, 'rgba(255,220,120,0.85)');
        grd.addColorStop(0.60, 'rgba(255,120,30,0.80)');
        grd.addColorStop(1.00, 'rgba(200,40,10,0.60)');
        ctx.fillStyle = grd;
        roundRect(ctx, c.x - w/2, c.y - h/2, w, h, Math.min(10, h/3));
        ctx.fill();
      }

      ctx.restore();
    }
  }
}

function drawBombs(ctx, gs) {
  if (!Array.isArray(gs.effects)) return;
  const t = state.GRID.tile;
  for (const fx of gs.effects) {
    if (fx.type !== 'bomb') continue;
    const r = Math.max(6, t * 0.22);
    const pulse = 0.5 + 0.5 * Math.sin((fx.timer || 0) * 6.283);
    circle(ctx, fx.x, fx.y, r * (0.9 + 0.2 * pulse), '#f44', true);
    ring(ctx, fx.x, fx.y, r + 4, '#faa');
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(8, (t * 0.28) | 0)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(Math.max(0, fx.timer)).toString(), fx.x, fx.y);
    ctx.restore();
  }
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

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y,   x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x,   y+h, rr);
  ctx.arcTo(x,   y+h, x,   y,   rr);
  ctx.arcTo(x,   y,   x+w, y,   rr);
  ctx.closePath();
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
