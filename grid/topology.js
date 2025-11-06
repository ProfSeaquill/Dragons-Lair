// grid/topology.js  (replace former grid/walls.js contents)

// ── import the source of truth for edges & virtual gates
import * as state from '../state.js';

const OPP = { N:'S', S:'N', E:'W', W:'E' };

export function neighbors4(gs, x, y) {
  // state.neighborsByEdges returns [{x,y,side:'N'|'E'|'S'|'W'}]
  return state.neighborsByEdges(gs, x, y);
}

export function degree(gs, x, y) {
  return neighbors4(gs, x, y).length;
}

export function isJunction(gs, x, y, prevDir) {
  const opts = neighbors4(gs, x, y);
  if (opts.length <= 1) return false;
  if (!prevDir) return opts.length >= 3;
  const forward = opts.filter(o => o.side !== OPP[prevDir]);
  return forward.length >= 2 || opts.length >= 3;
}

export function stepStraight(gs, x, y, prevDir) {
  if (!prevDir) return null;
  const nx = prevDir === 'E' ? x+1 : prevDir === 'W' ? x-1 : x;
  const ny = prevDir === 'S' ? y+1 : prevDir === 'N' ? y-1 : y;
  // Test by asking if that edge is open
  if (!state.isOpen(gs, x, y, prevDir)) return null;
  return { x:nx, y:ny, side:prevDir };
}

export function dirFromTo(ax, ay, bx, by) {
  if (bx === ax+1 && by === ay) return 'E';
  if (bx === ax-1 && by === ay) return 'W';
  if (bx === ax   && by === ay+1) return 'S';
  if (bx === ax   && by === ay-1) return 'N';
  return null;
}

export function forwardOptions(gs, x, y, prevDir) {
  const back = OPP[prevDir];
  return neighbors4(gs, x, y).filter(n => n.side !== back);
}

export function isDeadEnd(gs, x, y) {
  return degree(gs, x, y) <= 1;
}

// ASCII sketch that respects edge walls: a cell is “blocked” if it has 0 open neighbors
export function toAscii(gs, maxW = state.GRID.cols, maxH = state.GRID.rows) {
  let out = '';
  for (let y = 0; y < Math.min(state.GRID.rows, maxH); y++) {
    for (let x = 0; x < Math.min(state.GRID.cols, maxW); x++) {
      out += neighbors4(gs, x, y).length ? '.' : '#';
    }
    out += '\n';
  }
  return out;
}
