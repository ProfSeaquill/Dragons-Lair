// ai/topology.js
import * as state from '../state.js';

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


// Simple flood fill from a start tile to check reachability.

export function floodFrom(grid, start) {
  const W = grid.W, H = grid.H;
  const q = [ [start.tileX, start.tileY] ];
  const seen = new Set([ key(start.tileX, start.tileY) ]);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [nx, ny] of neighbors4(grid, x, y)) {
      const k = key(nx, ny);
      if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen; // Set of "x,y"
}

export function isEntryConnectedToExit(grid, entry, exit) {
  const seen = floodFrom(grid, entry);
  return seen.has(key(exit.tileX, exit.tileY));
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
