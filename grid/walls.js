// grid/walls.js — per-edge wall helpers + no-full-block guard
import * as state from '../state.js';


// passthrough shim so old imports keep working
export * from './topology.js';

// --- Canonical edge accessors ----------------------------------------------
// We store N/W on the current cell; E is neighbor.W; S is neighbor.N.
function getEdge(gs, x, y, side) {
  const rec = state.ensureCell(gs, x, y);
  if (!rec) return false;
  switch (side) {
    case 'N': return !!rec.N;
    case 'W': return !!rec.W;
    case 'E': {
      const nb = state.inBounds(x + 1, y) ? state.ensureCell(gs, x + 1, y) : null;
      return !!(nb && nb.W);
    }
    case 'S': {
      const nb = state.inBounds(x, y + 1) ? state.ensureCell(gs, x, y + 1) : null;
      return !!(nb && nb.N);
    }
    default:  return false;
  }
}

function setEdge(gs, x, y, side, on) {
  const rec = state.ensureCell(gs, x, y);
  if (!rec) return;
  switch (side) {
    case 'N': rec.N = !!on; break;
    case 'W': rec.W = !!on; break;
    case 'E': {
      const nb = state.inBounds(x + 1, y) ? state.ensureCell(gs, x + 1, y) : null;
      if (nb) nb.W = !!on;
      break;
    }
    case 'S': {
      const nb = state.inBounds(x, y + 1) ? state.ensureCell(gs, x, y + 1) : null;
      if (nb) nb.N = !!on;
      break;
    }
  }
}

// --- Public: query ----------------------------------------------------------
export function edgeHasWall(gs, x, y, side) {
  return getEdge(gs, x, y, side);
}

// Permanently place a small set of walls and bump topology once. 
export function installPermanentWalls(gs) 
{ const PERMA = [ [21, 6, 'N'], [22, 6, 'N'], [23, 6, 'N'], 
                 [20, 10, 'N'], [21, 11, 'N'], [22, 11, 'N'], 
                  [23, 11, 'N'], [20, 9, 'W'], [21, 10, 'W'], 
                 [21, 6, 'W'], [20, 7, 'N'], [20, 7, 'W'], ]; 
 for (
   const [x, y, side] of PERMA) 
   setEdge(gs, x, y, side, true); 
}



// --- Connectivity check (ENTRY ↔ EXIT must remain connected) ---------------
function connectedEntryToExit(gs) {
  const cols = state.GRID.cols, rows = state.GRID.rows;
  const start = { x: state.ENTRY.x, y: state.ENTRY.y };
  const goal  = { x: state.EXIT.x,  y: state.EXIT.y  };

  const seen = new Set();
  const q = [{ x: start.x, y: start.y }];
  const key = (x, y) => `${x},${y}`;

  while (q.length) {
    const { x, y } = q.shift();
    if (x === goal.x && y === goal.y) return true;
    const k = key(x, y);
    if (seen.has(k)) continue;
    seen.add(k);

    // Explore 4-neighbors if the *edge between cells* is open
    // (Use the same canonical storage as getEdge/setEdge)
    if (x + 1 < cols && !getEdge(gs, x, y, 'E')) q.push({ x: x + 1, y });
    if (y + 1 < rows && !getEdge(gs, x, y, 'S')) q.push({ x, y: y + 1 });
    if (x - 1 >= 0  && !getEdge(gs, x - 1, y, 'E')) q.push({ x: x - 1, y });
    if (y - 1 >= 0  && !getEdge(gs, x, y - 1, 'S')) q.push({ x, y: y - 1 });
  }
  return false;
}

// --- Public: toggle with guard ---------------------------------------------
/**
 * Toggle an edge wall. If placing would fully block ENTRY↔EXIT, we revert.
 * Returns true if final state has a wall, false otherwise.
 */
export function toggleEdge(gs, x, y, side) {
  const before = edgeHasWall(gs, x, y, side);
  const placing = !before;

  setEdge(gs, x, y, side, placing);

  // If we just placed, ensure connectivity; if blocked, revert.
  if (placing && !connectedEntryToExit(gs)) {
    setEdge(gs, x, y, side, false);
    state.bumpTopology?.(gs, 'walls:reject-block');
    return false;
  }

  // Notify topology rebuilders that the maze changed.
  state.bumpTopology?.(gs, placing ? 'walls:place' : 'walls:remove');
  return edgeHasWall(gs, x, y, side);
}
