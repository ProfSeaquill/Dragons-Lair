// combat/upgrades/abilities/wing_gust.js
//
// Visual FX for the Wing Gust ability using a 4-frame 96×96 spritesheet.
// Types:
//   - "wingGust"          → simple swirl at dragon (optional, currently unused)
//   - "wingGustCorridor"  → traveling gust along a tunnel path

import * as state from '../../../state.js';

const WING_FRAMES     = 4;
const WING_FRAME_SIZE = 96;

// 👉 Adjust this path to your actual PNG:
const WING_SPRITE_SRC = './assets/wing_gust_sprite.png';

const wingImg = new Image();
let wingReady = false;

wingImg.onload = () => {
  wingReady = true;
  console.log('[wingGust] sprite loaded', WING_SPRITE_SRC, wingImg.width, wingImg.height);
};
wingImg.onerror = (e) => {
  wingReady = false;
  console.error('[wingGust] FAILED TO LOAD SPRITE', WING_SPRITE_SRC, e);
};
wingImg.src = WING_SPRITE_SRC;

function isOnScreen(x, y, w, h, cw, ch) {
  const right  = x + w;
  const bottom = y + h;
  return !(right < 0 || bottom < 0 || x > cw || y > ch);
}

// -------------------------------------------------------------
// (A) OPTIONAL: SIMPLE SWIRL AT DRAGON CENTER
// -------------------------------------------------------------

export function spawnWingGustAtDragon(gs) {
  if (!gs) return;
  const list = gs.effects || (gs.effects = []);

  const tsize = state.GRID.tile || 32;
  const cells = state.dragonCells(gs);
  if (!cells || !cells.length) return;

  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const cx = sx / cells.length;
  const cy = sy / cells.length;

  const x = (cx + 0.5) * tsize;
  const y = (cy + 0.5) * tsize;

  const fx = {
    type:  'wingGust',
    x,
    y,
    t:   0,
    dur: 0.40,
    scale: 1.0
  };

  list.push(fx);
  console.log('[wingGust] spawn(center)', { x, y, effectsLen: list.length });
}

// -------------------------------------------------------------
// (B) MAIN: CORRIDOR GUST WAVE
// -------------------------------------------------------------

/**
 * Spawn a traveling corridor gust along a tile path.
 * - tilePath: array of { x, y } in TILE COORDS (not pixels)
 */
export function spawnWingGustCorridorFX(gs, tilePath, opts = {}) {
  if (!gs || !Array.isArray(tilePath) || tilePath.length === 0) return;
  const list = gs.effects || (gs.effects = []);

  const fx = {
    type: 'wingGustCorridor',
    // path stays in tile coords; renderer will convert to pixels
    path: tilePath.map(c => ({ x: c.x, y: c.y })),
    headT: 0,                      // "distance" in tiles traveled along path
    headIdx: 0,                    // integer index into path (updated in combat.js)
    speedTilesPerSec: opts.speedTilesPerSec ?? 25, // visual speed
    tailLen: opts.tailLen ?? 8,    // how many tiles behind the head stay visible
    life: 0                        // extra time after reaching the end
  };

  list.push(fx);
  console.log('[wingGust] spawn corridor', {
    len: fx.path.length,
    speedTilesPerSec: fx.speedTilesPerSec,
    tailLen: fx.tailLen
  });
}

// -------------------------------------------------------------
// RENDERING FOR BOTH TYPES
// -------------------------------------------------------------

export function drawWingGusts(ctx, gs) {
  if (!wingReady) return;
  const list = gs.effects || [];
  if (!Array.isArray(list) || !list.length) return;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const tsize = state.GRID.tile || 32;

  const sheetW = wingImg.width || (WING_FRAMES * WING_FRAME_SIZE);
  const sheetH = wingImg.height || WING_FRAME_SIZE;
  const fw = sheetW / WING_FRAMES;
  const fh = sheetH;

  let firstLog = false;

  // --- Simple center swirls, if any (currently optional) ---
  const centerGusts = list.filter(fx => fx && fx.type === 'wingGust');
  for (const fx of centerGusts) {
    const dur = fx.dur || 0.4;
    const t   = Math.min(1, (fx.t || 0) / dur);
    const frameIdx = Math.min(WING_FRAMES - 1, Math.floor(t * WING_FRAMES));
    const sx = frameIdx * fw;
    const sy = 0;
    const scale = fx.scale || 1.0;
    const dstW  = fw * scale;
    const dstH  = fh * scale;
    const x = fx.x;
    const y = fx.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!isOnScreen(x - dstW / 2, y - dstH / 2, dstW, dstH, cw, ch)) continue;

    const alpha = 1.0 - t;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      wingImg,
      sx, sy, fw, fh,
      x - dstW / 2, y - dstH / 2,
      dstW, dstH
    );
    ctx.restore();
  }

  // --- Corridor gust waves ---
  const waves = list.filter(fx => fx && fx.type === 'wingGustCorridor');
  if (waves.length && !drawWingGusts._loggedOnce) {
    drawWingGusts._loggedOnce = true;
    console.log('[wingGust] draw corridor waves', { count: waves.length });
    firstLog = true;
  }

  for (const fx of waves) {
    const path = fx.path || [];
    if (!path.length) continue;

    const headIdx = fx.headIdx ?? 0;
    const tailLen = fx.tailLen ?? 8;
    const start = Math.max(0, headIdx - tailLen);
    const end   = Math.min(path.length - 1, headIdx);

    for (let i = start; i <= end; i++) {
      const c = path[i];
      if (!c) continue;

      const px = (c.x + 0.5) * tsize;
      const py = (c.y + 0.5) * tsize;

      const age   = end - i;             // 0 = freshest (at head)
      const alpha = Math.max(0, 1 - age / tailLen);

      // For a bit of variation, use frame 0 at the head and higher frames toward the tail
      const frameIdx = Math.min(
        WING_FRAMES - 1,
        Math.floor((age / Math.max(1, tailLen)) * WING_FRAMES)
      );
      const sx = frameIdx * fw;
      const sy = 0;

      const scale = 1.0; // tweak if you want bigger gust tiles
      const dstW  = fw * scale;
      const dstH  = fh * scale;

      if (!isOnScreen(px - dstW / 2, py - dstH / 2, dstW, dstH, cw, ch)) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        wingImg,
        sx, sy, fw, fh,
        px - dstW / 2, py - dstH / 2,
        dstW, dstH
      );
      ctx.restore();
    }
  }
}
