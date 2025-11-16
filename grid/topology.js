// grid/topology.js
import * as state from '../state.js';

const OPP = { N:'S', S:'N', E:'W', W:'E' };
const FORK_MIN_RUN = 2; // side branch must stay a corridor for at least 2 tiles
const useGS = (maybeGs) => (maybeGs && maybeGs.GRID ? maybeGs : state.GameState);

// ───────────────── Registry (shim) ─────────────────
let __grid = null;
/** Install a grid API: { inBounds(x,y), isFree(x,y), neighbors4(x,y)->[{x,y,side}] } */
export function setGridApi(api) { __grid = api || null; }

// Fallback adapter: use state.neighborsByEdges(GameState, x, y)
function _neighbors4WithSides(x, y) {
  if (__grid && typeof __grid.neighbors4 === 'function') {
    const out = __grid.neighbors4(x, y) || [];
    return out
      .map(n => (n.side ? n : { x: n.x, y: n.y, side: guessSide(n, x, y) }))
      .filter(n => n.side && state.isOpen(state.GameState, x, y, n.side)); // <-- add this
  }
  const gs = state.GameState;
  const raw = state.neighborsByEdges(gs, x, y) || [];
  return raw.filter(n => n.side && state.isOpen(gs, x, y, n.side)); // <-- and this
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

// Count how many forward exits (excl. back edge) themselves continue (≥1 forward option).
function __fwdContinuations(x, y, prevDir) {
  const opts = neighbors4(x, y);
  if (opts.length <= 1) return 0;
  const back = prevDir ? OPP[prevDir] : null;
  let cont = 0;
  for (const o of opts) {
    if (back && o.side === back) continue;       // exclude back edge
    // look ahead one step and see if that tile has at least one forward option
    const next = neighbors4(o.x, o.y);
    if (!next || !next.length) continue;
    cont++;
  }
  return cont;
}

function __stepFrom(x, y, dir) {
  if (dir === 'E') return [x+1, y];
  if (dir === 'W') return [x-1, y];
  if (dir === 'S') return [x, y+1];
  if (dir === 'N') return [x, y-1];
  return [x, y];
}

// Count straight-vs-side continuations relative to prevDir
function __continuations_at(x, y, prevDir) {
  const opts = neighbors4(x, y);
  const back = prevDir ? OPP[prevDir] : null;
  let straightCont = 0, sideCont = 0;
  for (const o of opts) {
    if (back && o.side === back) continue;           // exclude back edge
    const ahead = neighbors4(o.x, o.y);
    if (!ahead || ahead.length === 0) continue;      // must continue
    if (prevDir && o.side === prevDir) straightCont++; else sideCont++;
  }
  return { straightCont, sideCont, deg: opts.length };
}


// Corridor-aware predicates with look-behind

export function isCorridor(x, y, prevDir) {
  const { straightCont, sideCont } = __continuations_at(x, y, prevDir);
  // “Corridor” = you can keep going straight and there are no side branches
  return (straightCont >= 1) && (sideCont === 0);
}

// How many steps can we walk forward from (sx,sy) as a 1-wide corridor
// (no side forks), given that we arrived there via `dir`?
function __corridorRunLenFrom(sx, sy, dir, maxSteps = FORK_MIN_RUN) {
  let steps = 0;
  let x = sx, y = sy;
  let prevDir = dir;

  while (steps < maxSteps) {
    const opts = neighbors4(x, y);
    const back = OPP[prevDir];

    // Forward exits = neighbors excluding the back edge
    const forwardOpts = opts.filter(o => o.side !== back);

    // Dead end or “no forward” → corridor stops
    if (!forwardOpts.length) break;

    // Corridor must be 1-wide: if more than 1 forward exit, it’s already a fork.
    if (forwardOpts.length > 1) break;

    const f = forwardOpts[0];

    // Step into the next tile
    x = f.x;
    y = f.y;
    prevDir = f.side;
    steps++;
  }

  return steps; // 0..maxSteps inclusive
}

export function isCorridorJunction(x, y, prevDir) {
  // Need heading to define “forward” vs “side”
  if (!prevDir) return false;

  // Look at the tile we came FROM (one step opposite prevDir)
  const [px, py] = __stepFrom(x, y, OPP[prevDir]);

  // We came out of a corridor (straight continuation, no side branches) …
  const prev = __continuations_at(px, py, prevDir);
  const cameFromCorridor = (prev.straightCont >= 1) && (prev.sideCont === 0);

  // … and NOW there’s at least one side branch at the current tile.
  const cur = __continuations_at(x, y, prevDir);
  const forkHere = (cur.sideCont >= 1);

  return cameFromCorridor && forkHere;
}

export function isJunction(x, y, prevDir) {
  return isCorridorJunction(x, y, prevDir);
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
