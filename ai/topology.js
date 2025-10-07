// ai/topology.js
import * as state from '../state.js';

function key(x,y){ return `${x},${y}`; }

// Accepts either a Grid (with isWalkable) or a GameState (uses neighborsByEdges)
export function floodFrom(gridOrGs, start) {
  const sx = start.tileX ?? start.x, sy = start.tileY ?? start.y;

  const useGrid = !!(gridOrGs && typeof gridOrGs.isWalkable === 'function');
  const gs = useGrid ? null : (gridOrGs && gridOrGs.enemies ? gridOrGs : state.GameState);

  const neighbors = useGrid
    ? (x, y) => {
        const out = [];
        if (gridOrGs.isWalkable(x+1,y)) out.push([x+1,y]);
        if (gridOrGs.isWalkable(x-1,y)) out.push([x-1,y]);
        if (gridOrGs.isWalkable(x,y+1)) out.push([x,y+1]);
        if (gridOrGs.isWalkable(x,y-1)) out.push([x,y-1]);
        return out;
      }
    : (x, y) => state.neighborsByEdges(gs, x, y).map(n => [n.x, n.y]);

  const q = [[sx, sy]];
  const seen = new Set([key(sx, sy)]);

  while (q.length) {
    const [x, y] = q.shift();
    for (const [nx, ny] of neighbors(x, y)) {
      const k = key(nx, ny);
      if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen; // Set of "x,y"
}

export function isEntryConnectedToExit(gridOrGs, entry, exit) {
  const seen = floodFrom(gridOrGs, entry);
  const ex = exit.tileX ?? exit.x, ey = exit.tileY ?? exit.y;
  return seen.has(key(ex, ey));
}

// (keep your computeShortestPath here too, unchanged)
/**
 * computeShortestPath(gridOrGs, [sx,sy], [tx,ty])
 * - If the first arg has isWalkable(x,y), we use that (plain grid).
 * - Otherwise we treat it as GameState and use state.neighborsByEdges(...) so walls are respected.
 * Returns an array of tiles [[nx,ny], ...] from the tile AFTER start to the goal, or [] if unreachable.
 */
export function computeShortestPath(gridOrGs, start, goal) {
  const [sx, sy] = start || [];
  const [tx, ty] = goal  || [];
  if (!Number.isInteger(sx) || !Number.isInteger(sy) ||
      !Number.isInteger(tx) || !Number.isInteger(ty)) return [];

  let neighbors;
  if (gridOrGs && typeof gridOrGs.isWalkable === 'function') {
    const g = gridOrGs;
    neighbors = (x, y) => {
      const out = [];
      if (g.isWalkable(x + 1, y)) out.push([x + 1, y]);
      if (g.isWalkable(x - 1, y)) out.push([x - 1, y]);
      if (g.isWalkable(x, y + 1)) out.push([x, y + 1]);
      if (g.isWalkable(x, y - 1)) out.push([x, y - 1]);
      return out;
    };
  } else {
    const gs = (gridOrGs && gridOrGs.enemies) ? gridOrGs : state.GameState;
    neighbors = (x, y) => state.neighborsByEdges(gs, x, y).map(n => [n.x, n.y]);
  }

  // BFS
  const startKey = state.tileKey(sx, sy);
  const goalKey  = state.tileKey(tx, ty);
  const q = [[sx, sy]];
  const seen = new Set([startKey]);
  const prev = new Map();

  while (q.length) {
    const [x, y] = q.shift();
    if (x === tx && y === ty) break;
    for (const [nx, ny] of neighbors(x, y)) {
      const k = state.tileKey(nx, ny);
      if (!seen.has(k)) {
        seen.add(k);
        prev.set(k, [x, y]);
        q.push([nx, ny]);
      }
    }
  }

  if (!seen.has(goalKey)) return [];

  // Reconstruct path (exclude start, include goal)
  const path = [];
  let cur = [tx, ty];
  while (cur && !(cur[0] === sx && cur[1] === sy)) {
    path.unshift(cur);
    const pk = state.tileKey(cur[0], cur[1]);
    cur = prev.get(pk) || null;
  }
  return path;
}

function neighbors4(grid, x, y) {
  const out = [];
  if (grid.isWalkable(x+1,y)) out.push([x+1,y]);
  if (grid.isWalkable(x-1,y)) out.push([x-1,y]);
  if (grid.isWalkable(x,y+1)) out.push([x,y+1]);
  if (grid.isWalkable(x,y-1)) out.push([x,y-1]);
  return out;
}

function key(x,y){ return `${x},${y}`; }
