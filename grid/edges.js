// grid/edges.js
import * as state from '../state.js';

export function edgeOpen(gs, x, y, dir) {
  // delegate to state.isOpen (your existing canonical edge check)
  return state.isOpen(gs, x, y, dir);
}

export function adjacentOpen(gs, ax, ay, bx, by) {
  const dir = (bx === ax+1 && by === ay) ? 'E'
           : (bx === ax-1 && by === ay) ? 'W'
           : (bx === ax && by === ay+1) ? 'S'
           : (bx === ax && by === ay-1) ? 'N'
           : null;
  return dir ? state.isOpen(gs, ax, ay, dir) : false;
}
