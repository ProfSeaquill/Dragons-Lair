// steering.js
import * as state from '../state.js'; // <-- add this import (path correct from ai/steering.js)

// Helper: can we move from (cx,cy) across `side`?
function canCross(gs, cx, cy, side) {
  return state.isOpen(gs, cx, cy, side);
}

// Move straight in e.dirX/e.dirY, but never cross a closed edge.
export function stepAlongDirection(e, dt, tileSize, speedTilesPerSec) {
  const gs = state.GameState;
  const pxPerSec = speedTilesPerSec * tileSize;

  // Intended direction
  let dx = e.dirX|0, dy = e.dirY|0;
  if (!dx && !dy) {
    dx = (e.dir === 'E') ? 1 : (e.dir === 'W') ? -1 : 0;
    dy = (e.dir === 'S') ? 1 : (e.dir === 'N') ? -1 : 0;
  }

  // Determine the edge we would cross if we leave this tile
  let side = null;
  if (dx ===  1 && dy === 0) side = 'E';
  if (dx === -1 && dy === 0) side = 'W';
  if (dx === 0 && dy ===  1) side = 'S';
  if (dx === 0 && dy === -1) side = 'N';

  const cx = e.tileX|0, cy = e.tileY|0;
  const step = pxPerSec * dt;
  let nx = e.x + dx * step;
  let ny = e.y + dy * step;

  // Pixel coordinate of the *boundary* we’d cross leaving (cx,cy)
  const centerX = (cx + 0.5) * tileSize;
  const centerY = (cy + 0.5) * tileSize;
  const boundaryX = (dx === 1) ? (cx + 1) * tileSize : (dx === -1) ? (cx) * tileSize : null;
  const boundaryY = (dy === 1) ? (cy + 1) * tileSize : (dy === -1) ? (cy) * tileSize : null;

  // If we would cross into the next tile this frame, gate it on walls.
  let crossing = false;
  if (boundaryX != null) {
    // moving right: boundary is to the right of center; moving left: to the left
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
    // Blocked: clamp to boundary-ε and stop forward commitment;
    // let the FSM pick a new plan on next tick.
    if (boundaryX != null) nx = boundaryX + (dx === 1 ? -0.001 : 0.001);
    if (boundaryY != null) ny = boundaryY + (dy === 1 ? -0.001 : 0.001);
    e.commitTilesLeft = 0;
  }

  e.x = nx; e.y = ny;
  e.tileX = Math.floor(e.x / tileSize);
  e.tileY = Math.floor(e.y / tileSize);
}

export function setDirToward(e, fromX, fromY, toX, toY) {
  e.dirX = Math.sign(toX - fromX);
  e.dirY = (e.dirX !== 0) ? 0 : Math.sign(toY - fromY);
}

// Follow a {x,y} path; only advance to the next tile if its edge is open.
export function followPath(e, dt, tileSize, speedTilesPerSec) {
  if (!e.path || e.path.length === 0) return;

  // Support both [{x,y}] and [[x,y]] safely; normalize to object.
  const head = e.path[0];
  const nx = Array.isArray(head) ? head[0] : head.x;
  const ny = Array.isArray(head) ? head[1] : head.y;

  // Already there? pop and return.
  if ((e.tileX|0) === nx && (e.tileY|0) === ny) { e.path.shift(); return; }

  // Which side are we trying to leave by?
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
    // Path invalid due to a wall: clear and replan next tick.
    e.path = null;
    e.commitTilesLeft = 0;
    return;
  }

  // Move toward center of target tile
  const targetX = (nx + 0.5) * tileSize;
  const targetY = (ny + 0.5) * tileSize;
  const pxPerSec = speedTilesPerSec * tileSize;
  const maxStep = pxPerSec * dt;

  const dx = targetX - e.x, dy = targetY - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxStep) {
    e.x = targetX; e.y = targetY;
    e.tileX = nx; e.tileY = ny;
    e.path.shift();
  } else {
    e.x += (dx / dist) * maxStep;
    e.y += (dy / dist) * maxStep;
    e.tileX = Math.floor(e.x / tileSize);
    e.tileY = Math.floor(e.y / tileSize);
  }
}
