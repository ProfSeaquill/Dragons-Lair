// combat/upgrades/abilities/claw.js
//
// Handles the Claw visual FX using a 4-frame 96×96 spritesheet.
// Effect type: "clawSlash"
// Usage:
//   spawnClawSlashEffect(gs, x, y, angle)
//   drawClawSlashes(ctx, gs)

const CLAW_FRAMES      = 4;
const CLAW_FRAME_SIZE  = 96;

// 👉 Adjust this path to wherever you put the PNG in your project:
const CLAW_SPRITE_SRC  = 'assets/claw_slash.png';

const clawImg = new Image();
let clawReady = false;

clawImg.onload = () => { clawReady = true; };
clawImg.src = CLAW_SPRITE_SRC;

// Simple screen culling so we don’t draw off-canvas
function isOnScreen(x, y, w, h, cw, ch) {
  const right  = x + w;
  const bottom = y + h;
  return !(right < 0 || bottom < 0 || x > cw || y > ch);
}

/**
 * Spawn a clawSlash effect at a given world position.
 * - gs: GameState
 * - x, y: pixel coordinates
 * - angle: radians (dragon → target)
 */
export function spawnClawSlashEffect(gs, x, y, angle = 0) {
  const list = gs.effects || (gs.effects = []);
  list.push({
    type:  'clawSlash',
    x,
    y,
    angle,
    t:     0,
    dur:   0.35,  // lifetime in seconds (tweaked in effect cull in combat.js)
    scale: 1.0
  });
}

/**
 * Render all clawSlash effects from gs.effects using the spritesheet.
 */
export function drawClawSlashes(ctx, gs) {
  if (!clawReady) return;
  const list = gs.effects || [];
  if (!Array.isArray(list) || !list.length) return;

  const sheetW = clawImg.width;
  const sheetH = clawImg.height;
  const fw = sheetW / CLAW_FRAMES;
  const fh = sheetH;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  for (const fx of list) {
    if (!fx || fx.type !== 'clawSlash') continue;

    const dur = fx.dur || 0.35;
    const t   = Math.min(1, (fx.t || 0) / dur);

    const x = fx.x;
    const y = fx.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    // Frame 0→3 over lifetime
    const frameIdx = Math.min(CLAW_FRAMES - 1, Math.floor(t * CLAW_FRAMES));
    const sx = frameIdx * fw;
    const sy = 0;

    const scale = fx.scale || 1.0;
    const dstW  = fw * scale;
    const dstH  = fh * scale;

    if (!isOnScreen(x - dstW / 2, y - dstH / 2, dstW, dstH, cw, ch)) continue;

    // Simple fade-out as the slash finishes
    const alpha = 0.2 + 0.8 * (1 - t); // 1.0 → 0.2 over time

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(fx.angle || 0);

    ctx.drawImage(
      clawImg,
      sx, sy, fw, fh,
      -dstW / 2, -dstH / 2,
      dstW, dstH
    );

    ctx.restore();
  }
}

