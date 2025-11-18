// grid/edges.js
import * as state from '../state.js';
import { edgeHasWall } from './walls.js';

/**
 * Physical passability across an edge (N/E/S/W) between (x,y) and its neighbor.
 * - No dragon virtual gates here; those are handled in topology/neighbors.
 * - Returns false if out of bounds or if a wall blocks the edge.
 */
export function edgeOpen(gs, x, y, side) {
  gs = gs || state.GameState;
  if (!state.inBounds(x, y)) return false;

  // neighbor
  let nx = x, ny = y;
  switch (side) {
    case 'E': nx = x + 1; break;
    case 'W': nx = x - 1; break;
    case 'S': ny = y + 1; break;
    case 'N': ny = y - 1; break;
    default: return false;
  }
  if (!state.inBounds(nx, ny)) return false;

  // Canonical: open iff there is NOT a wall on that edge
  return !edgeHasWall(gs, x, y, side);
}

/** Convenience: are two orthogonally-adjacent cells connected physically? */
export function adjacentOpen(gs, ax, ay, bx, by) {
  const side =
    (bx === ax + 1 && by === ay) ? 'E' :
    (bx === ax - 1 && by === ay) ? 'W' :
    (bx === ax && by === ay + 1) ? 'S' :
    (bx === ax && by === ay - 1) ? 'N' :
    null;
  return side ? edgeOpen(gs, ax, ay, side) : false;
}
