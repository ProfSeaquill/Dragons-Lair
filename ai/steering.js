// ai/steering.js
import * as state from '../state.js';

// Helper: can we move from (cx,cy) across `side`?
function canCross(gs, cx, cy, side) {
  return state.isOpen(gs, cx, cy, side);
}

function ensureFinite(n, fallback) {
  return Number.isFinite(n) ? n : fallback;
}

function ensurePos(px, py, tileSize, cx, cy) {
  const t = ensureFinite(tileSize, 32);
  // If px/py are not finite, snap to tile center (or (cx,cy) if provided)
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    const x = Number.isFinite(cx) ? cx : 0;
    const y = Number.isFinite(cy) ? cy : 0;
    return { x: (x + 0.5) * t, y: (y + 0.5) * t };
  }
  return { x: px, y: py };
}

function vecFromDir(e) {
  let dx = e.dirX|0, dy = e.dirY|0;
  if (!dx && !dy) {
    const d = e.dir || 'E';
    dx = (d === 'E') ? 1 : (d === 'W') ? -1 : 0;
    dy = (d === 'S') ? 1 : (d === 'N') ? -1 : 0;
    // persist so the next frame has vectors ready
    e.dirX = dx; e.dirY = dy;
  }
  return { dx, dy };
}

// Move straight in e.dirX/e.dirY, but never cross a closed edge.
export function stepAlongDirection(e, dt, tileSize, speedTilesPerSec) {
  const gs = state.GameState;
  const t  = ensureFinite(tileSize, state.GRID.tile || 32);
  const sp = ensureFinite(speedTilesPerSec, ensureFinite(e.speed, e.speedBase ?? 2.5));
  const pxPerSec = ensureFinite(sp * t, (e.pxPerSec ?? 80)); // last-resort px/sec fallback

  // Ensure tile indices exist
  if (!Number.isInteger(e.tileX) || !Number.isInteger(e.tileY)) {
    e.tileX = Math.floor(ensureFinite(e.x, 0) / t);
    e.tileY = Math.floor(ensureFinite(e.y, 0) / t);
  }

  // Ensure pixel position is valid
  const pos = ensurePos(e.x, e.y, t, e.tileX, e.tileY);
  e.x = pos.x; e.y = pos.y;

  // Intended direction (persist vectors)
  const { dx, dy } = vecFromDir(e);

  // Determine the edge we would cross
  let side = null;
  if (dx ===  1 && dy === 0) side = 'E';
  if (dx === -1 && dy === 0) side = 'W';
  if (dx === 0 && dy ===  1) side = 'S';
  if (dx === 0 && dy === -1) side = 'N';

  const cx = e.tileX|0, cy = e.tileY|0;
  const step = ensureFinite(pxPerSec * ensureFinite(dt, 0.016), 0);
  let nx = e.x + dx * step;
  let ny = e.y + dy * step;

  // Boundary of the current tile
  const boundaryX = (dx === 1) ? (cx + 1) * t : (dx === -1) ? (cx) * t : null;
  const boundaryY = (dy === 1) ? (cy + 1) * t : (dy === -1) ? (cy) * t : null;

  // Will we cross into the next tile this frame?
  let crossing = false;
  if (boundaryX != null) {
    const goingRight = dx === 1;
    const before = goingRight ? (e.x < boundaryX) : (e.x > boundaryX);
    const after  = goingRight ? (nx >= boundaryX) : (nx <= boundaryX);
    crossing = before && after;
  } else if (boundaryY != null) {
    const goingDown = dy === 1;
    const before = goingDown ? (e.y < boundaryY) : (e.y > boundaryY);
    const after  = goingDown ? (ny >= boundaryY) : (ny <= boundaryY);
    crossing = before && after;
  }

  if (crossing && side && !canCross(gs, cx, cy, side)) {
    // Clamp to boundary - ε, drop commit, and let FSM rethink.
    if (boundaryX != null) nx = boundaryX + (dx === 1 ? -0.001 : 0.001);
    if (boundaryY != null) ny = boundaryY + (dy === 1 ? -0.001 : 0.001);
    e.commitTilesLeft = 0;
  }

  // Integrate & refresh tile coords
  e.x = ensureFinite(nx, e.x);
  e.y = ensureFinite(ny, e.y);
  e.tileX = Math.floor(e.x / t);
  e.tileY = Math.floor(e.y / t);
}

// Choose a primary axis toward a tile target (grid coords)
export function setDirToward(e, fromX, fromY, toX, toY) {
  const dx = Math.sign((toX|0) - (fromX|0));
  const dy = Math.sign((toY|0) - (fromY|0));
  e.dirX = dx !== 0 ? dx : 0;
  e.dirY = (dx !== 0) ? 0 : dy;
  e.dir  = (e.dirX === 1) ? 'E' : (e.dirX === -1) ? 'W' : (e.dirY === 1) ? 'S' : 'N';
}

// Follow a {x,y} path; only advance if the edge is open.
export function followPath(e, dt, tileSize, speedTilesPerSec) {
  if (!e.path || e.path.length === 0) return;

  const t  = ensureFinite(tileSize, state.GRID.tile || 32);
  const sp = ensureFinite(speedTilesPerSec, ensureFinite(e.speed, e.speedBase ?? 2.5));
  const pxPerSec = ensureFinite(sp * t, (e.pxPerSec ?? 80));
  const maxStep = ensureFinite(pxPerSec * ensureFinite(dt, 0.016), 0);

  // Ensure tile/pixel are sane
  if (!Number.isInteger(e.tileX) || !Number.isInteger(e.tileY)) {
    e.tileX = Math.floor(ensureFinite(e.x, 0) / t);
    e.tileY = Math.floor(ensureFinite(e.y, 0) / t);
  }
  const pos = ensurePos(e.x, e.y, t, e.tileX, e.tileY);
  e.x = pos.x; e.y = pos.y;

  const head = e.path[0];
  const nx = Array.isArray(head) ? (head[0]|0) : (head.x|0);
  const ny = Array.isArray(head) ? (head[1]|0) : (head.y|0);

  // Already there? pop and return.
  if ((e.tileX|0) === nx && (e.tileY|0) === ny) { e.path.shift(); return; }

  const cx = e.tileX|0, cy = e.tileY|0;
  let side = null;
  if (nx === cx + 1 && ny === cy) side = 'E';
  else if (nx === cx - 1 && ny === cy) side = 'W';
  else if (ny === cy + 1 && nx === cx) side = 'S';
  else if (ny === cy - 1 && nx === cx) side = 'N';
  else {
    // Non-4-neighbor (bad path); drop it and let FSM replan.
    e.path = null;
    e.commitTilesLeft = 0;
    return;
  }

  // Gate the step on the wall model.
  if (!state.isOpen(state.GameState, cx, cy, side)) {
    e.path = null;
    e.commitTilesLeft = 0;
    return;
  }

  // Move toward center of target tile
  const targetX = (nx + 0.5) * t;
  const targetY = (ny + 0.5) * t;
  const dx = targetX - e.x, dy = targetY - e.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= maxStep) {
    e.x = targetX; e.y = targetY;
    e.tileX = nx; e.tileY = ny;
    e.path.shift();
  } else {
    const inv = dist > 0 ? (maxStep / dist) : 0;
    e.x += dx * inv;
    e.y += dy * inv;
    e.tileX = Math.floor(e.x / t);
    e.tileY = Math.floor(e.y / t);
  }

  // Keep logical facing coherent with motion (helps decision/charge logic)
  if (Math.abs(dx) >= Math.abs(dy)) {
    e.dirX = Math.sign(dx); e.dirY = 0;
    e.dir  = e.dirX >= 0 ? 'E' : 'W';
  } else {
    e.dirX = 0; e.dirY = Math.sign(dy);
    e.dir  = e.dirY >= 0 ? 'S' : 'N';
  }
}
