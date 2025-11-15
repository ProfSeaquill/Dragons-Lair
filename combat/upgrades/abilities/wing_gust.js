// combat/upgrades/abilities/wing_gust.js
//
// Handles the Wing Gust gameplay push + visual FX using a 4-frame 96×96 spritesheet.
// Effect type: "wingGust"
// Usage:
//   wingGustPush(gs, tiles);              // gameplay: shove enemies & bombs
//   spawnWingGustAtDragon(gs);            // visual: spawn gust FX at dragon
//   drawWingGusts(ctx, gs);               // render from render.js

import * as state from '../../../state.js';

// -------------------------------------------------------------
// SPRITE LOADING
// -------------------------------------------------------------

const WING_FRAMES     = 4;
const WING_FRAME_SIZE = 96;

// 👉 Adjust this path to match your actual PNG location
const WING_SPRITE_SRC = './assets/wing_gust.png';

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

// Simple culling helper (duplicated from claw.js for isolation)
function isOnScreen(x, y, w, h, cw, ch) {
  const right  = x + w;
  const bottom = y + h;
  return !(right < 0 || bottom < 0 || x > cw || y > ch);
}

// -------------------------------------------------------------
// GAMEPLAY: PUSH ENEMIES & BOMBS
// -------------------------------------------------------------

// You can now delete the old wingGustPush definition from combat.js
export function wingGustPush(gs, tiles) {
  const t = state.GRID.tile || 32;

  // Dragon anchor (centroid of dragon footprint)
  const cells = state.dragonCells(gs);
  if (!cells || !cells.length) return;

  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const ax = Math.round(sx / Math.max(1, cells.length));
  const ay = Math.round(sy / Math.max(1, cells.length));

  // ---- Enemies ----
  for (const e of gs.enemies || []) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    if (e.type === 'engineer' && e.tunneling) continue; // don’t shove burrowers

    const dx0 = e.cx - ax, dy0 = e.cy - ay;
    const distMan = Math.abs(dx0) + Math.abs(dy0);
    if (distMan <= 0) continue;                 // sitting inside dragon; ignore
    if (distMan > tiles) continue;              // out of gust radius

    const pushSteps = Math.max(0, tiles - distMan);
    if (pushSteps === 0) continue;

    // Pick outward direction along dominant axis (away from anchor)
    let dir;
    if (Math.abs(dx0) >= Math.abs(dy0)) dir = (dx0 >= 0) ? 'E' : 'W';
    else                                dir = (dy0 >= 0) ? 'S' : 'N';

    // Walk step-by-step, respecting walls and not shoving into dragon
    let nx = e.cx, ny = e.cy;
    for (let k = 0; k < pushSteps; k++) {
      const step = stepIfOpen(gs, nx, ny, dir);
      if (step.x === nx && step.y === ny) break;            // blocked
      if (state.isDragonCell(step.x, step.y, gs)) break;    // don't push into dragon
      nx = step.x; ny = step.y;
    }

    if (nx === e.cx && ny === e.cy) continue;

    // Build the per-tile path we just traced
    const path = [{ x: e.cx, y: e.cy }];
    {
      const dx0b = e.cx - ax, dy0b = e.cy - ay;
      const dir2 = (Math.abs(dx0b) >= Math.abs(dy0b))
        ? (dx0b >= 0 ? 'E' : 'W')
        : (dy0b >= 0 ? 'S' : 'N');
      let px = e.cx, py = e.cy;
      const steps = Math.max(1, Math.abs(nx - e.cx) + Math.abs(ny - e.cy));
      for (let k = 0; k < steps; k++) {
        const step = stepIfOpen(gs, px, py, dir2);
        if (step.x === px && step.y === py) break;
        if (state.isDragonCell(step.x, step.y, gs)) break;
        px = step.x; py = step.y;
        path.push({ x: px, y: py });
        if (px === nx && py === ny) break;
      }
    }

    if (path.length >= 2) {
      e.kb = {
        path,
        seg: 0,
        acc: 0,
        durPerTile: 0.08,            // tune: 0.06 snappier, 0.12 chunkier
        tsize: state.GRID.tile || 32
      };
      e.isAttacking     = false;
      e.pausedForAttack = false;
      e.commitDir       = null;
      e.commitSteps     = 0;
      e.commitTilesLeft = 0;

      // tiny tick just to show HP bar flash
      markHit(e, 0.0001);
    }
  }

  // ---- Bombs (optional, same falloff & walls) ----
  for (const fx of (gs.effects || [])) {
    if (fx.type !== 'bomb') continue;
    let cx = Math.floor(fx.x / t);
    let cy = Math.floor(fx.y / t);

    const dx0 = cx - ax, dy0 = cy - ay;
    const distMan = Math.abs(dx0) + Math.abs(dy0);
    if (distMan <= 0 || distMan > tiles) continue;

    const pushSteps = Math.max(0, tiles - distMan);
    let dir;
    if (Math.abs(dx0) >= Math.abs(dy0)) dir = (dx0 >= 0) ? 'E' : 'W';
    else                                dir = (dy0 >= 0) ? 'S' : 'N';

    for (let k = 0; k < pushSteps; k++) {
      const step = stepIfOpen(gs, cx, cy, dir);
      if (step.x === cx && step.y === cy) break;
      cx = step.x; cy = step.y;
    }

    fx.x = (cx + 0.5) * t;
    fx.y = (cy + 0.5) * t;
  }
}

// -------------------------------------------------------------
// VISUAL: SPAWN FX AT DRAGON CENTER
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
  console.log('[wingGust] spawn', { x, y, effectsLen: list.length });
}

// -------------------------------------------------------------
// RENDERING
// -------------------------------------------------------------

export function drawWingGusts(ctx, gs) {
  if (!wingReady) return;
  const list = gs.effects || [];
  if (!Array.isArray(list) || !list.length) return;

  const gusts = list.filter(fx => fx && fx.type === 'wingGust');
  if (!gusts.length) return;

  if (!drawWingGusts._loggedOnce) {
    drawWingGusts._loggedOnce = true;
    console.log('[wingGust] draw pass', {
      count: gusts.length,
      imgW: wingImg.width,
      imgH: wingImg.height
    });
  }

  const sheetW = wingImg.width;
  const sheetH = wingImg.height;
  const fw = sheetW / WING_FRAMES;
  const fh = sheetH;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  for (const fx of gusts) {
    const dur = fx.dur || 0.4;
    const t   = Math.min(1, (fx.t || 0) / dur);

    const x = fx.x;
    const y = fx.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const frameIdx = Math.min(WING_FRAMES - 1, Math.floor(t * WING_FRAMES));
    const sx = frameIdx * fw;
    const sy = 0;

    const scale = fx.scale || 1.0;
    const dstW  = fw * scale;
    const dstH  = fh * scale;

    if (!isOnScreen(x - dstW / 2, y - dstH / 2, dstW, dstH, cw, ch)) continue;

    const alpha = 1.0 - t;   // fades out

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.drawImage(
      wingImg,
      sx, sy, fw, fh,
      -dstW / 2, -dstH / 2,
      dstW, dstH
    );
    ctx.restore();
  }
}
