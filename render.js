// render.js — cave background, bone-edge walls, hover glow,
// dragon sprite + mouth fire, corridor flames, bombs, distance hints,
// and subtle heat shimmer near the dragon’s mouth

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
const FIRE_FRAMES = 4; // set to your sheet's frame count
fireImg.onload = () => { fireReady = true; };
fireImg.src = './assets/fire_breath.png'; // N frames wide, 1 row

/* -----------------------------------------------------------
 * FLAME STRIPS (corridor fire) — optional textures
 * --------------------------------------------------------- */
const fireStripH = new Image();
const fireStripV = new Image();
let fireHReady = false, fireVReady = false;
// Uncomment and provide assets if you have them:
// fireStripH.onload = () => (fireHReady = true);
// fireStripV.onload = () => (fireVReady = true);
// fireStripH.src = './assets/fire_strip_h.png';
// fireStripV.src = './assets/fire_strip_v.png';

/* -----------------------------------------------------------
 * CAVE BACKDROP (grid-sized art)
 * --------------------------------------------------------- */
const caveImg = new Image();
let caveReady = false;
caveImg.onload = () => { caveReady = true; };
caveImg.src = './assets/cave_backdrop.png'; // or 1536x1024 etc.

// === Map lighting (trail torches) ===
// === Tiny torch lights (point-light look) ===
const TORCH = {
  ambient: 0.70,                 // base darkness
  // radii relative to one tile — small, like real torches
  coreR: () => state.GRID.tile * 0.55,   // fully clear center
  midR:  () => state.GRID.tile * 0.95,   // steep falloff
  edgeR: () => state.GRID.tile * 1.35,   // soft fringe

  // where to place torches along corridors
  step: 3,          // every N cells (sparser = larger number)
  junctionBoost: 1, // extra torches at 3/4-way intersections (0 to disable)
  warmGlow: 0.14,   // 0..0.25 warm additive tint (set 0 for neutral)
};

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

/* -----------------------------------------------------------
 * Cave / Bone visual tunables
 * --------------------------------------------------------- */
const COLORS = {
  caveBg: '#0e1526',
  caveDot: 'rgba(255,255,255,0.05)',
  caveBlotch: 'rgba(160,180,220,0.05)',
  gridLine: 'rgba(255,255,255,0.025)',

  boneFill: '#e9e5db',            // off-white ivory
  boneEdge: 'rgba(0,0,0,0.25)',   // subtle edge stroke for depth
  boneShade: 'rgba(0,0,0,0.12)',  // tiny “joint” dots

  hoverBone: 'rgba(255,255,255,0.9)', // hover glow

  entryFill: '#0b4',
  entryRing: '#1f7',
};

const BONE = {
  segLenPx: () => Math.max(10, state.GRID.tile * 0.28),  // capsule length
  segGapPx: () => Math.max(3,  state.GRID.tile * 0.08),  // gap between capsules
  thickness: () => Math.max(4,  state.GRID.tile * 0.20), // capsule thickness
  endDot: () => Math.max(1,  state.GRID.tile * 0.06),    // tiny “joint” dot
  jitter: () => Math.max(0.4, state.GRID.tile * 0.02),   // organic wobble
};

/* -----------------------------------------------------------
 * Cave pattern + vignette
 * --------------------------------------------------------- */
let _cavePattern = null;
function getCavePattern(ctx) {
  if (_cavePattern) return _cavePattern;
  const size = 96;
  const p = document.createElement('canvas');
  p.width = p.height = size;
  const c = p.getContext('2d');

  // Base fill
  c.fillStyle = COLORS.caveBg;
  c.fillRect(0, 0, size, size);

  // Speckle
  for (let i = 0; i < 280; i++) {
    c.fillStyle = COLORS.caveDot;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 1.1 + 0.2;
    circle(c, x, y, r, c.fillStyle, true);
  }

  // Blotches
  for (let i = 0; i < 6; i++) {
    const grad = c.createRadialGradient(
      Math.random() * size, Math.random() * size, 0,
      Math.random() * size, Math.random() * size, Math.random() * (size * 0.6) + size * 0.2
    );
    grad.addColorStop(0, COLORS.caveBlotch);
    grad.addColorStop(1, 'transparent');
    c.fillStyle = grad;
    c.beginPath(); c.rect(0,0,size,size); c.fill();
  }

  _cavePattern = ctx.createPattern(p, 'repeat');
  return _cavePattern;
}

function drawVignette(ctx) {
  const { width, height } = ctx.canvas;
  const cx = width * 0.55, cy = height * 0.5; // slight bias toward dragon side
  const rOuter = Math.hypot(width, height) * 0.65;
  const g = ctx.createRadialGradient(cx, cy, rOuter * 0.15, cx, cy, rOuter);
  g.addColorStop(0, 'rgba(0,0,0,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* -----------------------------------------------------------
 * Public: draw the entire frame
 * --------------------------------------------------------- */
export function draw(ctx, gs = state.GameState) {
  const { width, height } = ctx.canvas;

  ctx.imageSmoothingEnabled = false;

  // -------- Background: image if ready, otherwise procedural pattern
ctx.clearRect(0, 0, width, height);

if (caveReady) {
  // If your art exactly matches GRID size, this is a perfect 1:1 draw
  ctx.drawImage(caveImg, 0, 0, width, height);
} else {
  // fallback: your existing procedural cave background
  ctx.save();
  ctx.fillStyle = getCavePattern(ctx);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// Optional: keep vignette to add depth even on the painted backdrop
drawVignette(ctx);


  // -------- Grid (ultra faint, optional)
  drawFaintTiles(ctx);

  // -------- Entry (green ring). Exit is represented by dragon sprite.
  drawEntry(ctx);

  // -------- Distance-field hints
  drawDistHints(ctx, gs);

  // -------- Bone edge walls + hover preview
  drawEdgeWallsAsBones(ctx, gs);
  drawHoverEdgeAsBone(ctx, gs);

  // -------- Enemies / Dragon / Mouth fire / Heat shimmer
  drawEnemies(ctx, gs);
  drawDragonAndMouthFire(ctx, gs);
  drawHeatShimmer(ctx, gs); // subtle, after dragon + fire for overlay look

  // -------- Corridor fire (traveling flame)
  drawFlameWaves(ctx, gs);

  // -------- Bombs (engineer)
  drawBombs(ctx, gs);

   drawTorchPoints(ctx, gs);
}

/* ===================== visuals ===================== */

function drawFaintTiles(ctx, gs = state.GameState) {
  const t = state.GRID.tile;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  // Vertical lines
  for (let x = 0; x <= state.GRID.cols; x++) {
    const px = x * t + 0.5;
    // Only draw line segments that are NOT inside the dragon zone
    let y = 0;
    while (y < state.GRID.rows) {
      // advance while we're in a visible stretch
      let y0 = y;
      while (y < state.GRID.rows && !state.isDragonCell(x, y, gs) && !state.isDragonCell(x - 1, y, gs)) y++;
      if (y > y0) { ctx.moveTo(px, y0 * t); ctx.lineTo(px, y * t); }
      // skip over the dragon zone (don’t draw those segments)
      while (y < state.GRID.rows && (state.isDragonCell(x, y, gs) || state.isDragonCell(x - 1, y, gs))) y++;
    }
  }

  // Horizontal lines
  for (let y = 0; y <= state.GRID.rows; y++) {
    const py = y * t + 0.5;
    let x = 0;
    while (x < state.GRID.cols) {
      let x0 = x;
      while (x < state.GRID.cols && !state.isDragonCell(x, y, gs) && !state.isDragonCell(x, y - 1, gs)) x++;
      if (x > x0) { ctx.moveTo(x0 * t, py); ctx.lineTo(x * t, py); }
      while (x < state.GRID.cols && (state.isDragonCell(x, y, gs) || state.isDragonCell(x, y - 1, gs))) x++;
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawEntry(ctx) {
  const ep = centerOf(state.ENTRY.x, state.ENTRY.y);
  circle(ctx, ep.x, ep.y, state.GRID.tile * 0.28, COLORS.entryFill, true);
  ring(ctx, ep.x, ep.y, state.GRID.tile * 0.32, COLORS.entryRing);
}

/** -------- Bone walls -------- */
function drawEdgeWallsAsBones(ctx, gs) {
  const t = state.GRID.tile;

  for (let y = 0; y < state.GRID.rows; y++) {
    for (let x = 0; x < state.GRID.cols; x++) {
      const rec = state.ensureCell(gs, x, y);
      const x0 = x * t, y0 = y * t, x1 = x0 + t, y1 = y0 + t;

      if (rec.N) boneEdge(ctx, x0, y0, x1, y0);
      if (rec.W) boneEdge(ctx, x0, y0, x0, y1);

      // avoid double-drawing shared edges
      if (x === state.GRID.cols - 1 && rec.E) boneEdge(ctx, x1, y0, x1, y1);
      if (y === state.GRID.rows - 1 && rec.S) boneEdge(ctx, x0, y1, x1, y1);
    }
  }
}

function drawHoverEdgeAsBone(ctx, gs) {
  const hover = gs.uiHoverEdge;
  if (!hover) return;

  const t = state.GRID.tile;
  const x0 = hover.x * t, y0 = hover.y * t, x1 = x0 + t, y1 = y0 + t;

  ctx.save();
  ctx.shadowColor = COLORS.hoverBone;
  ctx.shadowBlur = Math.max(6, t * 0.28);
  ctx.globalAlpha = 0.85;

  switch (hover.side) {
    case 'N': boneEdge(ctx, x0, y0, x1, y0); break;
    case 'S': boneEdge(ctx, x0, y1, x1, y1); break;
    case 'W': boneEdge(ctx, x0, y0, x0, y1); break;
    case 'E': boneEdge(ctx, x1, y0, x1, y1); break;
  }

  ctx.restore();
}

function boneEdge(ctx, x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len <= 0) return;

  const segL = BONE.segLenPx();
  const gap  = BONE.segGapPx();
  const thick = BONE.thickness();
  const jitter = BONE.jitter();
  const endDotR = BONE.endDot();

  const n = Math.max(1, Math.floor((len + gap) / (segL + gap)));
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;

  for (let i = 0; i < n; i++) {
    const a = (i * (segL + gap)) + (segL * 0.5);
    const cx = x0 + ux * a;
    const cy = y0 + uy * a;

    // perpendicular jitter for organic wobble
    const j = (Math.random() * 2 - 1) * jitter;
    const px = -uy * j, py = ux * j;

    drawCapsule(ctx, cx + px, cy + py, segL, thick, Math.atan2(y1 - y0, x1 - x0));

    // tiny “joint” dots at capsule tips
    const ex = cx + ux * (segL * 0.5), ey = cy + uy * (segL * 0.5);
    const sx = cx - ux * (segL * 0.5), sy = cy - uy * (segL * 0.5);
    circle(ctx, ex, ey, endDotR, COLORS.boneShade, true);
    circle(ctx, sx, sy, endDotR * 0.85, COLORS.boneShade, true);
  }
}

function drawCapsule(ctx, cx, cy, w, h, angleRad = 0) {
  const r = h * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angleRad);

  // fill
  ctx.fillStyle = COLORS.boneFill;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5 + r, -r);
  ctx.lineTo( w * 0.5 - r, -r);
  ctx.arc(  w * 0.5 - r, 0, r, -Math.PI/2,  Math.PI/2);
  ctx.lineTo(-w * 0.5 + r,  r);
  ctx.arc( -w * 0.5 + r, 0, r,  Math.PI/2, -Math.PI/2);
  ctx.closePath();
  ctx.fill();

  // subtle edge stroke for definition
  ctx.strokeStyle = COLORS.boneEdge;
  ctx.lineWidth = Math.max(1, h * 0.08);
  ctx.stroke();

  ctx.restore();
}

/* ===================== enemies, dragon, fire, shimmer ===================== */

function drawEnemies(ctx, gs) {
  if (!Array.isArray(gs.enemies)) return;
  const r = Math.max(3, state.GRID.tile * 0.22);
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  for (const e of gs.enemies) {
    const p = enemyPixelPosition(e);
    if (!p) continue;

    const bodyColor = TYPE_COLOR[e.type] || (e?.shield ? '#5cf' : '#fc3');
    circle(ctx, p.x, p.y, r, bodyColor, true);
    if (e?.shield)   ring(ctx, p.x, p.y, r + 2, '#9df');
    if (e?.miniboss) ring(ctx, p.x, p.y, r + 5, '#f7a');

    // Optional HP bar logic (kept if you use e.showHpUntil / e.maxHp)
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

function drawDragonAndMouthFire(ctx, gs) {
  const p = centerOf(state.EXIT.x, state.EXIT.y);
  const size = Math.round(state.GRID.tile * 3);
  const half = size / 2;

  // Dragon sprite
  if (dragonReady) {
    ctx.drawImage(dragonImg, p.x - half, p.y - half, size, size);
  } else {
    // fallback placeholder
    circle(ctx, p.x, p.y, Math.max(6, state.GRID.tile * 0.35), '#b33', true);
    ring(ctx, p.x, p.y, Math.max(6, state.GRID.tile * 0.35) + 3, '#f88');
  }

  // Mouth fire overlay (if attacking)
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
      frame * fw, 0, fw, fh,             // source
      mouthX, mouthY - fh / 2, fw, fh    // dest near mouth
    );
  }
}

/**
 * Subtle heat shimmer near the dragon’s mouth.
 * Cheap effect: layered soft gradients with small sinusoidal offsets and blur.
 * No assets required. It’s subtle by default; tweak SHIM values to taste.
 */
function drawHeatShimmer(ctx, gs) {
  const fx = gs.dragonFX || {};
  // Show shimmer if attacking OR (subtly) always-on near mouth
  const active = fx.attacking || true;

  if (!active) return;

  const p = centerOf(state.EXIT.x, state.EXIT.y);
  const baseX = p.x + Math.round(state.GRID.tile * 0.75);
  const baseY = p.y - Math.round(state.GRID.tile * 0.15);

  const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() * 0.001 : Date.now() * 0.001;

  const SHIM = {
    w: state.GRID.tile * 1.6,
    h: state.GRID.tile * 0.9,
    layers: 3,
    amp: state.GRID.tile * 0.06,   // horizontal waviness
    drift: state.GRID.tile * 0.02, // vertical drift
    alpha: 0.12,                   // per-layer alpha
    blurPx: Math.max(0, Math.floor(state.GRID.tile * 0.10)),
  };

  for (let i = 0; i < SHIM.layers; i++) {
    const phase = t * (1.2 + i * 0.35) + i * 1.7;
    const dx = Math.sin(phase) * SHIM.amp * (1 - i / SHIM.layers);
    const dy = Math.cos(phase * 0.7) * SHIM.drift * (1 - i / SHIM.layers);

    const x = baseX + dx + i * state.GRID.tile * 0.2;
    const y = baseY + dy + i * state.GRID.tile * 0.02;

    const w = SHIM.w * (1 + i * 0.15);
    const h = SHIM.h * (1 - i * 0.12);

    // Soft heat haze blob
    const g = ctx.createRadialGradient(x, y, 1, x, y, Math.max(w, h));
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.35, 'rgba(255,200,120,0.18)');
    g.addColorStop(1, 'rgba(255,120,40,0.00)');

    ctx.save();
    // a touch of blur to feel refractive
    if ('filter' in ctx) ctx.filter = `blur(${SHIM.blurPx}px)`;
    ctx.globalAlpha = SHIM.alpha;
    ctx.globalCompositeOperation = 'lighter';

    ctx.fillStyle = g;
    ctx.beginPath();
    roundRect(ctx, x - w / 2, y - h / 2, w, h, Math.min(12, h / 3));
    ctx.fill();

    ctx.restore();
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

      const horiz = (seg.dir === 'h');
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

/* ===================== distance hints & bombs ===================== */

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

/* ===================== primitives & helpers ===================== */

function drawTorchPoints(ctx, gs) {
  const { width, height } = ctx.canvas;

  // 1) Global darkness
  ctx.save();
  ctx.globalAlpha = TORCH.ambient;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // 2) Collect torch positions (grid centers)
  const pts = computeTorchPoints(gs);

  // 3) Carve 3-zone spots (destination-out) so sprites show true color
  for (const p of pts) carveSpot(ctx, p.x, p.y);

  // 4) Optional warm glow so it reads torchy, not neutral
  if (TORCH.warmGlow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of pts) {
      const r = TORCH.midR() * 0.85;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0.00, `rgba(255,190,90,${TORCH.warmGlow})`);
      g.addColorStop(1.00, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

function carveSpot(ctx, x, y) {
  const rCore = TORCH.coreR();
  const rMid  = TORCH.midR();
  const rEdge = TORCH.edgeR();

  // Core: fully clear
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath(); ctx.arc(x, y, rCore, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // Mid ring: steep falloff
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const gMid = ctx.createRadialGradient(x, y, rCore, x, y, rMid);
  gMid.addColorStop(0.00, 'rgba(0,0,0,1)');
  gMid.addColorStop(1.00, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = gMid;
  ctx.beginPath(); ctx.arc(x, y, rMid, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  // Edge feather
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const gEdge = ctx.createRadialGradient(x, y, rMid, x, y, rEdge);
  gEdge.addColorStop(0.00, 'rgba(0,0,0,0.28)');
  gEdge.addColorStop(1.00, 'rgba(0,0,0,0.00)');
  ctx.fillStyle = gEdge;
  ctx.beginPath(); ctx.arc(x, y, rEdge, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

// Decide where torches go: sparse along straight corridors + at junctions,
// plus anchors at ENTRY and EXIT. Cheap, frame-safe heuristic (no BFS needed).
function computeTorchPoints(gs) {
  const pts = [];
  const t = state.GRID.tile;

  // Always light ENTRY and EXIT
  pts.push(tileCenterPx(state.ENTRY.x, state.ENTRY.y));
  pts.push(tileCenterPx(state.EXIT.x,  state.EXIT.y));

  for (let y = 0; y < state.GRID.rows; y++) {
    for (let x = 0; x < state.GRID.cols; x++) {
      const rec = state.ensureCell(gs, x, y);
      const opens = [
        state.isOpen(gs, x, y, 'N'),
        state.isOpen(gs, x, y, 'E'),
        state.isOpen(gs, x, y, 'S'),
        state.isOpen(gs, x, y, 'W'),
      ];
      const openCount = opens.filter(Boolean).length;

      // Only consider traversable cells
      if (openCount === 0) continue;

      // Straight corridors (N/S open or E/W open but not both)
      const straight =
        (opens[0] && opens[2] && !opens[1] && !opens[3]) || // N & S
        (opens[1] && opens[3] && !opens[0] && !opens[2]);   // E & W

      // Junctions (3 or 4 exits): put a light to anchor intersections
      const junction = openCount >= 3;

      if (junction) {
        if (TORCH.junctionBoost) pts.push(tileCenterPx(x, y));
        continue;
      }

      if (straight) {
        // Place a torch every Nth cell along the corridor grid (checker / step)
        if (((x + y) % TORCH.step) === 0) pts.push(tileCenterPx(x, y));
        continue;
      }

      // Corners (two adjacent opens): occasional torch
      if (openCount === 2 && !straight) {
        if (((x * 7 + y * 11) % (TORCH.step + 1)) === 0) pts.push(tileCenterPx(x, y));
      }
    }
  }
  return pts;
}

function tileCenterPx(x, y) {
  return {
    x: x * state.GRID.tile + state.GRID.tile / 2,
    y: y * state.GRID.tile + state.GRID.tile / 2,
  };
}


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

function enemyPixelPosition(e) {
  if (typeof e.x === 'number' && typeof e.y === 'number') {
    return { x: e.x, y: e.y };
  }
  if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
    return centerOf(e.cx, e.cy);
  }
  return null;
}
