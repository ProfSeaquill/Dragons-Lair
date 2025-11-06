// grid/edges.js
export function edgeOpen(gs, x, y, dir) {
  return isOpen(gs, x, y, dir); // single, explicit name
}

export function adjacentOpen(gs, ax, ay, bx, by) {
  const dir = (bx === ax+1 && by === ay) ? 'E'
           : (bx === ax-1 && by === ay) ? 'W'
           : (bx === ax && by === ay+1) ? 'S'
           : (bx === ax && by === ay-1) ? 'N'
           : null;
  return dir ? isOpen(gs, ax, ay, dir) : false;
}
