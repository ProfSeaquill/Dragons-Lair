// render.js — cave walls, hover edge, units, HUD adornments

import { GRID, GameState, ENTRY, EXIT, inBounds, ensureCell } from './state.js';


const STYLE = {
  bg: '#0e1526',
  grid: 'rgba(255,255,255,0.05)',
  caveWall: '#8aa0c8',
  caveWallShadow: 'rgba(0,0,0,0.35)',
  hoverPlace: '#6cf',
  hoverRemove: '#f96',
  entry: '#86efac',
  exit: '#fca5a5',
  dragon: '#f97316',
  enemy: '#cbd5e1',
  enemyBoss: '#f87171',
  distanceArrow: 'rgba(175, 187, 220, 0.25)',
};

const FLAGS = {
  drawGrid: true,
  drawDistanceHints: false, // toggle to true if you want faint arrows toward exit
};

export function draw(ctx, gs = GameState) {
  const { width: W, height: H } = ctx.canvas;

  // Background
  ctx.save();
  ctx.fillStyle = STYLE.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Grid (subtle)
  if (FLAGS.drawGrid) drawGrid(ctx);

  // Cave walls (per-edge)
  drawCaveEdges(ctx, gs);

  // Edge hover highlight (from UI)
  drawHoverEdge(ctx, gs);

  // Entry / Exit markers
  drawEntryExit(ctx);

  // Optional: distance arrows (field “flow” preview)
  if (FLAGS.drawDistanceHints) drawDistanceArrows(ctx, gs);

  // Units
  drawDragon(ctx, gs);
  drawEnemies(ctx, gs);
}

/* ===================== helpers ===================== */

function drawGrid(ctx) {
  const t = GRID.tile;
  ctx.save();
  ctx.strokeStyle = STYLE.grid;
  ctx.lineWidth = 1;
  // Vertical
  for (let x = 0; x <= GRID.cols; x++) {
    const px = x * t + 0.5; // crisp line
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, GRID.rows * t);
    ctx.stroke();
  }
  // Horizontal
  for (let y = 0; y <= GRID.rows; y++) {
    const py = y * t + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(GRID.cols * t, py);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCaveEdges(ctx, gs) {
  const t = GRID.tile;
  ctx.save();
  ctx.lineWidth = Math.max(2, Math.floor(t * 0.14));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft shadow pass for depth
  ctx.strokeStyle = STYLE.caveWallShadow;
  forEachEdgeWall(gs, (x, y, side) => {
    strokeEdge(ctx, x, y, side, t, 1.5);
  });

  // Main wall pass
  ctx.strokeStyle = STYLE.caveWall;
  forEachEdgeWall(gs, (x, y, side) => {
    strokeEdge(ctx, x, y, side, t, 0);
  });

  ctx.restore();
}

function forEachEdgeWall(gs, fn) {
  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      const rec = ensureCell(gs, x, y);
      if (rec.N) fn(x, y, 'N');
      if (rec.E) fn(x, y, 'E');
      if (rec.S) fn(x, y, 'S');
      if (rec.W) fn(x, y, 'W');
    }
  }
}

function strokeEdge(ctx, x, y, side, t, offset = 0) {
  const x0 = x * t, y0 = y * t, x1 = x0 + t, y1 = y0 + t;
  ctx.beginPath();
  switch (side) {
    case 'N':
      ctx.moveTo(x0 + 4, y0 + 0.5 + offset);
      ctx.lineTo(x1 - 4, y0 + 0.5 + offset);
      break;
    case 'S':
      ctx.moveTo(x0 + 4, y1 - 0.5 + offset);
      ctx.lineTo(x1 - 4, y1 - 0.5 + offset);
      break;
    case 'W':
      ctx.moveTo(x0 + 0.5 + offset, y0 + 4);
      ctx.lineTo(x0 + 0.5 + offset, y1 - 4);
      break;
    case 'E':
      ctx.moveTo(x1 - 0.5 + offset, y0 + 4);
      ctx.lineTo(x1 - 0.5 + offset, y1 - 4);
      break;
  }
  ctx.stroke();
}

function drawHoverEdge(ctx, gs) {
  const t = GRID.tile;
  const h = gs.uiHoverEdge;
  if (!h || !inBounds(h.x, h.y)) return;

  const rec = ensureCell(gs, h.x, h.y);
  const hasWall = !!rec[h.side];

  ctx.save();
  ctx.lineWidth = Math.max(3, Math.floor(t * 0.18));
  ctx.strokeStyle = hasWall ? STYLE.hoverRemove : STYLE.hoverPlace;
  ctx.globalAlpha = 0.95;
  strokeEdge(ctx, h.x, h.y, h.side, t, 0);
  ctx.restore();
}

function drawEntryExit(ctx) {
  const t = GRID.tile;

  // Entry
  drawCellMarker(ctx, ENTRY.x, ENTRY.y, STYLE.entry);

  // Exit
  drawCellMarker(ctx, EXIT.x, EXIT.y, STYLE.exit);

  function drawCellMarker(ctx, cx, cy, color) {
    const cxpx = cx * t + t / 2;
    const cypy = cy * t + t / 2;
    const r = Math.max(5, Math.floor(t * 0.22));
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cxpx, cypy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawDragon(ctx, gs) {
  // For now: dragon is “stationed” at EXIT center.
  const t = GRID.tile;
  const x = EXIT.x * t + t / 2;
  const y = EXIT.y * t + t / 2;

  ctx.save();
  ctx.shadowColor = STYLE.dragon;
  ctx.shadowBlur = Math.max(8, Math.floor(t * 0.35));
  ctx.fillStyle = STYLE.dragon;
  const R = Math.max(7, Math.floor(t * 0.28));
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemies(ctx, gs) {
  const t = GRID.tile;

  for (const e of gs.enemies) {
    // Position: prefer pixel coords if present (smooth), otherwise tile center
    const cx = inBounds(e.cx | 0, e.cy | 0) ? e.cx | 0 : 0;
    const cy = inBounds(e.cx | 0, e.cy | 0) ? e.cy | 0 : 0;
    const center = {
      x: (e.x != null ? e.x : (cx * t + t / 2)),
      y: (e.y != null ? e.y : (cy * t + t / 2)),
    };

    const isBoss = !!e.miniboss || e.type?.startsWith?.('boss:');
    const color = isBoss ? STYLE.enemyBoss : STYLE.enemy;
    const r = Math.max(5, Math.floor(t * (isBoss ? 0.28 : 0.22)));

    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Facing “beak” to show dir
    if (e.dir) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const tip = dirUnit(e.dir);
      ctx.beginPath();
      ctx.moveTo(center.x + tip.x * r, center.y + tip.y * r);
      ctx.lineTo(center.x + tip.x * (r + 4) - tip.y * 3, center.y + tip.y * (r + 4) + tip.x * 3);
      ctx.lineTo(center.x + tip.x * (r + 4) + tip.y * 3, center.y + tip.y * (r + 4) - tip.x * 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function dirUnit(d) {
    switch (d) {
      case 'N': return { x: 0, y: -1 };
      case 'S': return { x: 0, y: 1 };
      case 'E': return { x: 1, y: 0 };
      case 'W': return { x: -1, y: 0 };
      default:  return { x: 0, y: 0 };
    }
  }
}

function drawDistanceArrows(ctx, gs) {
  const t = GRID.tile;
  const field = gs.distFromEntry;
  if (!field) return;

  ctx.save();
  ctx.strokeStyle = STYLE.distanceArrow;
  ctx.lineWidth = 1;

  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      const here = field[y]?.[x];
      if (here == null || !isFinite(here)) continue;

      // Find neighbor with strictly smaller distance (downhill toward ENTRY)
      let best = null, bestD = here;
      const rec = ensureCell(gs, x, y);

      const candidates = [];
      if (!rec.N && inBounds(x, y - 1)) candidates.push({ nx: x, ny: y - 1 });
      if (!rec.E && inBounds(x + 1, y)) candidates.push({ nx: x + 1, ny: y });
      if (!rec.S && inBounds(x, y + 1)) candidates.push({ nx: x, ny: y + 1 });
      if (!rec.W && inBounds(x - 1, y)) candidates.push({ nx: x - 1, ny: y });

      for (const c of candidates) {
        const d = field[c.ny]?.[c.nx];
        if (d != null && d < bestD) { bestD = d; best = c; }
      }
      if (!best) continue;

      // Draw a small arrow from tile center toward best neighbor
      const cx = x * t + t / 2;
      const cy = y * t + t / 2;
      const bx = best.nx * t + t / 2;
      const by = best.ny * t + t / 2;

      const dx = bx - cx, dy = by - cy;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;

      const len = Math.max(6, Math.floor(t * 0.25));
      const ex = cx + ux * len, ey = cy + uy * len;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  ctx.restore();
}
// render.js — cave edge rendering + hover highlight + lightweight sprites


/**
 * Public: draw the entire frame.
 * - No reliance on a single precomputed path; uses edge walls & dist field.
 * - Safe if enemies use either (x,y) pixels OR (cx,cy) cells.
 */
export function draw(ctx, gs = GameState) {
  const { width, height } = ctx.canvas;

  // -------- Background
  ctx.clearRect(0, 0, width, height);
  fillRect(ctx, 0, 0, width, height, '#0e1526');

  // Optional: faint tiles to keep spatial readability
  drawFaintTiles(ctx);

  // -------- Entry / Exit markers
  drawEntryExit(ctx);

  // -------- Distance-field hints (tiny arrows trending "forward" away from ENTRY)
  drawDistHints(ctx, gs);

  // -------- Cave edges (walls)
  drawEdgeWalls(ctx, gs);

  // -------- Hover edge highlight (from UI)
  drawHoverEdge(ctx, gs);

  // -------- Enemies / Dragon
  drawEnemies(ctx, gs);
  drawDragon(ctx, gs);
}

/* ===================== helpers ===================== */

function drawFaintTiles(ctx) {
  const t = GRID.tile;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= GRID.cols; x++) {
    const px = x * t + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, GRID.rows * t);
  }
  for (let y = 0; y <= GRID.rows; y++) {
    const py = y * t + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(GRID.cols * t, py);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEntryExit(ctx) {
  const ep = centerOf(ENTRY.x, ENTRY.y);
  const xp = centerOf(EXIT.x, EXIT.y);

  // ENTRY
  circle(ctx, ep.x, ep.y, GRID.tile * 0.28, '#0b4', true);
  ring(ctx, ep.x, ep.y, GRID.tile * 0.32, '#1f7');

  // EXIT / Dragon lair mouth
  circle(ctx, xp.x, xp.y, GRID.tile * 0.28, '#844', true);
  ring(ctx, xp.x, xp.y, GRID.tile * 0.32, '#c88');
}

function drawEdgeWalls(ctx, gs) {
  const t = GRID.tile;
  ctx.save();
  ctx.strokeStyle = '#9fb4d8';
  ctx.lineWidth = Math.max(3, Math.floor(t * 0.12));
  ctx.lineCap = 'round';

  // Draw only N and W edges for each cell to avoid double-drawing,
  // then do a pass for the outermost E/S border cells.
  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      const rec = ensureCell(gs, x, y);
      const x0 = x * t, y0 = y * t, x1 = x0 + t, y1 = y0 + t;

      // North edge
      if (rec.N) {
        seg(ctx, x0, y0, x1, y0);
      }
      // West edge
      if (rec.W) {
        seg(ctx, x0, y0, x0, y1);
      }

      // East edge (only for last column)
      if (x === GRID.cols - 1 && rec.E) {
        seg(ctx, x1, y0, x1, y1);
      }
      // South edge (only for last row)
      if (y === GRID.rows - 1 && rec.S) {
        seg(ctx, x0, y1, x1, y1);
      }
    }
  }
  ctx.restore();
}

function drawHoverEdge(ctx, gs) {
  const hover = gs.uiHoverEdge;
  if (!hover) return;

  const t = GRID.tile;
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
  const t = GRID.tile;
  const dist = gs.distFromEntry;
  if (!dist) return;

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#8fb3ff';

  // Tiny arrow inside each cell pointing toward *increasing* distance
  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      const d0 = dist?.[y]?.[x];
      if (!isFinite(d0)) continue;

      // Pick a neighbor with larger distance (moving "forward" from entry)
      let best = null, bestD = d0;
      // E,S,W,N order for a nice consistent flow
      const candidates = [
        [x + 1, y],
        [x, y + 1],
        [x - 1, y],
        [x, y - 1],
      ];
      for (const [nx, ny] of candidates) {
        if (!inBounds(nx, ny)) continue;
        const dn = dist?.[ny]?.[nx];
        if (isFinite(dn) && dn > bestD) { bestD = dn; best = { nx, ny }; }
      }
      if (!best) continue;

      const a = centerOf(x, y);
      const b = centerOf(best.nx, best.ny);
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      // short arrow
      const ux = (dx / L) * (t * 0.22);
      const uy = (dy / L) * (t * 0.22);

      // dot body
      circle(ctx, a.x + ux, a.y + uy, Math.max(2, t * 0.06), '#8fb3ff', true);
    }
  }

  ctx.restore();
}

function drawEnemies(ctx, gs) {
  if (!Array.isArray(gs.enemies)) return;
  const r = Math.max(3, GRID.tile * 0.22);

  for (const e of gs.enemies) {
    const p = enemyPixelPosition(e);
    if (!p) continue;

    // Body
    circle(ctx, p.x, p.y, r, e?.shield ? '#5cf' : '#fc3', true);

    // Shield ring if any
    if (e?.shield) ring(ctx, p.x, p.y, r + 2, '#9df');

    // Miniboss ring flare
    if (e?.miniboss) ring(ctx, p.x, p.y, r + 5, '#f7a');
  }
}

function drawDragon(ctx, gs) {
  // If you already have a dragon sprite elsewhere, feel free to replace this.
  const p = centerOf(EXIT.x, EXIT.y);
  const r = Math.max(6, GRID.tile * 0.35);
  circle(ctx, p.x, p.y, r, '#b33', true);
  ring(ctx, p.x, p.y, r + 3, '#f88');
}

/* ===================== tiny primitives ===================== */

function centerOf(cx, cy) {
  return {
    x: cx * GRID.tile + GRID.tile / 2,
    y: cy * GRID.tile + GRID.tile / 2,
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

/* ===================== position helpers ===================== */

function enemyPixelPosition(e) {
  // Prefer pixel coords if provided by interpolated movement
  if (typeof e.x === 'number' && typeof e.y === 'number') {
    return { x: e.x, y: e.y };
  }
  // Otherwise fall back to cell center
  if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
    return centerOf(e.cx, e.cy);
  }
  return null;
}
