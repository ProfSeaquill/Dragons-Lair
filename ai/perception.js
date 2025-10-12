// ai/perception.js
import * as state from '../state.js';
import { neighbors4, cellDegree } from './topology.js';

// Junction helpers (degree-based)
export function isJunction(gs, x, y) {        // ≥3 exits
  return cellDegree(gs, x, y) >= 3;
}
export function isDeadEnd(gs, x, y) {         // ≤1 exit
  return cellDegree(gs, x, y) <= 1;
}
export function isCorridor(gs, x, y) {        // exactly 2 exits
  return cellDegree(gs, x, y) === 2;
}
// Some state machines want a single “decision node” check:
export function isDecisionNode(gs, x, y) {
  // junctions OR dead-ends are “decision points”; corridors are not
  const d = cellDegree(gs, x, y);
  return d !== 2;
}

// (optional) re-export for convenience if other modules want degrees directly
export { cellDegree } from './topology.js';

// “Visible” neighbors respecting edge walls
export function visibleNeighbors(gs, cx, cy) {
  if (!state.inBounds(cx, cy)) return [];
  return neighbors4(gs, cx, cy);
}

// Simple BFS list of reachable cells from EXIT (useful for previews, etc.)
export function reachableFromExit(gs) {
  const key = (x,y) => `${x},${y}`;
  const seen = new Set();
  const out = [];
  const q = [{ x: state.EXIT.x, y: state.EXIT.y }];
  seen.add(key(q[0].x, q[0].y));

  while (q.length) {
    const p = q.shift();
    out.push(p);
    for (const n of neighbors4(gs, p.x, p.y)) {
      const k = key(n.x, n.y);
      if (!seen.has(k)) { seen.add(k); q.push(n); }
    }
  }
  return out;
}

// Axis-aligned raycast along grid edges (N/E/S/W). True if all crossed edges are open.
export function raycastLineClear(gs, x0, y0, x1, y1) {
  if (x0 !== x1 && y0 !== y1) return false; // only straight lines
  let x = x0, y = y0;
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  const steps = Math.abs(x1 - x0) + Math.abs(y1 - y0);
  for (let i = 0; i < steps; i++) {
    const side = dx > 0 ? 'E' : dx < 0 ? 'W' : dy > 0 ? 'S' : 'N';
    if (!state.isOpen(gs, x, y, side)) return false;
    if (dx !== 0) x += dx; else y += dy;
  }
  return true;
}

export function nearestDragonCellTile(gs, tx, ty) {
  let best = null, bestD = Infinity;
  for (const c of state.dragonCells(gs)) {
    const d = Math.abs(c.x - tx) + Math.abs(c.y - ty);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { target: best, manhattan: bestD };
}

export function canAttackDragon(gs, e) {
  const tx = Number.isInteger(e.tileX) ? e.tileX : (e.cx|0);
  const ty = Number.isInteger(e.tileY) ? e.tileY : (e.cy|0);
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false;
  const { target, manhattan } = nearestDragonCellTile(gs, tx, ty);
  const range = (typeof e.range === 'number') ? e.range : 1;
  return !!target && manhattan <= range;
}

// True if the unit at (cx,cy) has straight line-of-sight to ANY dragon cell (same row/col), respecting walls.
export function canSeeDragon(gs, cx, cy, { maxTiles = state.GRID.cols + state.GRID.rows } = {}) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
  const cells = state.dragonCells(gs);
  for (const d of cells) {
    if (cx === d.x || cy === d.y) {
      const dist = Math.abs(d.x - cx) + Math.abs(d.y - cy);
      if (dist <= maxTiles && raycastLineClear(gs, cx, cy, d.x, d.y)) return true;
    }
  }
  return false;
}
