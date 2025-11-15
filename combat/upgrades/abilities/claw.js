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
const CLAW_SPRITE_SRC  = './assets/claw_slash.png';

const clawImg = new Image();
let clawReady = false;

clawImg.onload = () => {
  clawReady = true;
  console.log('[claw] sprite loaded', CLAW_SPRITE_SRC, clawImg.width, clawImg.height);
};
clawImg.onerror = (e) => {
  clawReady = false;
  console.error('[claw] FAILED TO LOAD SPRITE', CLAW_SPRITE_SRC, e);
};
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
// combat/upgrades/abilities/claw.js

export function spawnClawSlashEffect(gs, x, y, angle = 0) {
  const list = gs.effects || (gs.effects = []);

  const fx = {
    type:  'clawSlash',
    x,
    y,
    angle,
    t:     0,
    dur:   2.00,  // longer life so it's clearly visible
    scale: 4.0    // noticeably bigger than the enemy
  };
  list.push(fx);
  // one-line debug: how many claw effects exist this frame?
  console.log('[claw] spawn', { x, y, angle, effectsLen: list.length });
}



/**
 * Render all clawSlash effects from gs.effects using the spritesheet.
 */
export function drawClawSlashes(ctx, gs) {
  if (!clawReady) return;
  const list = gs.effects || [];
  if (!Array.isArray(list) || !list.length) return;

  // Count how many slashes exist
  const slashes = list.filter(fx => fx && fx.type === 'clawSlash');
  if (!slashes.length) return;

  // One-time debug so we know this renderer is actually running
  if (!drawClawSlashes._loggedOnce) {
    drawClawSlashes._loggedOnce = true;
    console.log('[claw] draw pass', {
      count: slashes.length,
      imgW: clawImg.width,
      imgH: clawImg.height
    });
  }

  const sheetW = clawImg.width;
  const sheetH = clawImg.height;
  const fw = sheetW / CLAW_FRAMES; // expect 4 frames across
  const fh = sheetH;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  for (const fx of slashes) {
    const dur = fx.dur || 0.7;
    const t   = Math.min(1, (fx.t || 0) / dur);

    const x = fx.x;
    const y = fx.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    // Frame 0→3 over lifetime
    const frameIdx = Math.min(CLAW_FRAMES - 1, Math.floor(t * CLAW_FRAMES));
    const sx = frameIdx * fw;
    const sy = 0;

    const scale = fx.scale || 1.4;
    const dstW  = fw * scale;
    const dstH  = fh * scale;

    if (!isOnScreen(x - dstW / 2, y - dstH / 2, dstW, dstH, cw, ch)) continue;

    // Strong alpha at start, fades toward zero
    const alpha = 1.0 - t;   // 1 → 0 over lifetime

    ctx.save();
    ctx.globalAlpha = alpha; // set, don't multiply
    ctx.translate(x, y);
    ctx.rotate(fx.angle || 0);

    // DEBUG: bright marker so we can’t miss it
ctx.save();
ctx.globalAlpha = 1;
ctx.fillStyle = 'magenta';
ctx.beginPath();
ctx.arc(0, 0, 10, 0, Math.PI * 2);
ctx.fill();
ctx.restore();


    ctx.drawImage(
      clawImg,
      sx, sy, fw, fh,
      -dstW / 2, -dstH / 2,
      dstW, dstH
    );

    ctx.restore();
  }
}


