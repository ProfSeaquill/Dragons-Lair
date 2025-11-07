// grid/topology.js
import * as state from '../state.js';
import { isOpenEdge } from './edges.js';


const OPP = { N:'S', S:'N', E:'W', W:'E' };
const useGS = (maybeGs) => (maybeGs && maybeGs.GRID ? maybeGs : state.GameState);

// ───────────────── Registry (shim) ─────────────────
let __grid = null;
/** Install a grid API: { inBounds(x,y), isFree(x,y), neighbors4(x,y)->[{x,y,side}] } */
export function setGridApi(api) { __grid = api || null; }

// Fallback adapter: use state.neighborsByEdges(GameState, x, y)
function _neighbors4WithSides(x, y) {
  if (__grid && typeof __grid.neighbors4 === 'function') {
    // allow either shape: [{x,y}] or [{x,y,side}]
    const out = __grid.neighbors4(x, y) || [];
    return out.map(n => (n.side ? n : { x: n.x, y: n.y, side: guessSide(n, x, y) }));
  }
  const gs = state.GameState;
  // state.neighborsByEdges returns [{x,y,side}]
  return state.neighborsByEdges(gs, x, y);
}

function guessSide(n, x, y) {
  if (n.x === x+1 && n.y === y) return 'E';
  if (n.x === x-1 && n.y === y) return 'W';
  if (n.x === x && n.y === y+1) return 'S';
  if (n.x === x && n.y === y-1) return 'N';
  return null;
}

// ───────────── Public API (no gs required) ─────────────
/** Returns neighbors as {x,y,side} objects (side is from the SOURCE (x,y)) */
export function neighbors4(x, y) {
  // directpath.js expects at least {x,y}; keeping side too is fine.
  return _neighbors4WithSides(x, y).map(n => ({ x: n.x, y: n.y, side: n.side }));
}

export function degree(x, y) {
  return neighbors4(x, y).length;
}

/** Junction test with optional prevDir ('N'|'E'|'S'|'W') */
export function isJunction(x, y, prevDir) {
  const opts = neighbors4(x, y);
  if (opts.length <= 1) return false;
  if (!prevDir) return opts.length >= 3;
  const back = OPP[prevDir];
  const forward = opts.filter(o => o.side !== back);
  return forward.length >= 2 || opts.length >= 3;
}

export function dirFromTo(ax, ay, bx, by) {
  if (bx === ax+1 && by === ay) return 'E';
  if (bx === ax-1 && by === ay) return 'W';
  if (bx === ax   && by === ay+1) return 'S';
  if (bx === ax   && by === ay-1) return 'N';
  return null;
}

/** Options excluding the “back” edge (needs prevDir) */
export function forwardOptions(x, y, prevDir) {
  if (!prevDir) return neighbors4(x, y);
  const back = OPP[prevDir];
  return neighbors4(x, y).filter(n => n.side !== back);
}

// ───────────── Optional helpers that still accept gs ─────────────
// Kept for places that pass gs explicitly (safe to leave as-is)
// Accepts (gs, x, y, prevDir) OR (x, y, prevDir)
export function stepStraight(a, b, c, d) {
  let gs, x, y, prevDir;
  if (d !== undefined) {
    // called as (gs, x, y, prevDir)
    gs = (a && a.GRID) ? a : state.GameState;
    x = b; y = c; prevDir = d;
  } else {
    // called as (x, y, prevDir)
    gs = state.GameState;
    x = a; y = b; prevDir = c;
  }
  if (!prevDir) return null;

  const nx = prevDir === 'E' ? x + 1
          : prevDir === 'W' ? x - 1
          : x;
  const ny = prevDir === 'S' ? y + 1
          : prevDir === 'N' ? y - 1
          : y;

  // Respect virtual gates + walls
  if (!state.isOpen(gs, x, y, prevDir)) return null;
  return { x: nx, y: ny, side: prevDir };
}


export function isDeadEnd(x, y) {
  return degree(x, y) <= 1;
}

// ASCII sketch for quick debugging
export function toAscii(gs, maxW = state.GRID.cols, maxH = state.GRID.rows) {
  let out = '';
  for (let y = 0; y < Math.min(state.GRID.rows, maxH); y++) {
    for (let x = 0; x < Math.min(state.GRID.cols, maxW); x++) {
      out += neighbors4(x, y).length ? '.' : '#';
    }
    out += '\n';
  }
  return out;
}
