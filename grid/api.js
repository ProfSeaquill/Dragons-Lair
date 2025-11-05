// grid/api.js
// Thin grid adapter for 4-way movement.
// Hides your map representation behind a simple API the pathing layer can use.
//
// Usage examples:
//
//   // 1) Backed by a Set of blocked "x,y" strings
//   const walls = new Set(["3,5", "4,5"]);
//   export const GRID = createGridApi({ cols: 24, rows: 16, blockedSet: walls });
//
//   // 2) Backed by a boolean 2D array (true = blocked)
//   const blockedGrid = Array.from({length: 16}, (_, y) => Array.from({length: 24}, (_, x) => false));
//   blockedGrid[5][3] = true; // (x=3,y=5) is blocked
//   export const GRID = createGridApi({ cols: 24, rows: 16, blockedGrid });
//
//   // 3) Backed by a custom predicate (return true if passable)
//   const passable = (x, y) => !(x === 3 && y === 5);
//   export const GRID = createGridApi({ cols: 24, rows: 16, passable });
//
// Then elsewhere:
//   import { GRID } from './grid/api.js';
//   if (GRID.isFree(10, 7)) { ... }
//   const ns = GRID.neighbors4(10, 7);
import * as state from '../state.js';

const DIR4 = [
  [ 1, 0],  // East
  [-1, 0],  // West
  [ 0, 1],  // South
  [ 0,-1],  // North
];

// Map a neighbor delta to an edge side from (x,y)
function _sideTo(nx, ny, x, y) {
  if (nx === x+1 && ny === y) return 'E';
  if (nx === x-1 && ny === y) return 'W';
  if (nx === x && ny === y+1) return 'S';
  if (nx === x && ny === y-1) return 'N';
  return null;
}

/**
 * neighbors4 that respects edge walls stored in state.ensureCell(...).
 * Uses your existing edgeHasWall(gs,x,y,side).
 */
export function neighbors4Open(gs, x, y) {
  const out = [];
  if (x+1 < state.GRID.cols && !edgeHasWall(gs, x, y, 'E')) out.push([x+1, y]);
  if (x-1 >= 0               && !edgeHasWall(gs, x, y, 'W')) out.push([x-1, y]);
  if (y+1 < state.GRID.rows && !edgeHasWall(gs, x, y, 'S')) out.push([x, y+1]);
  if (y-1 >= 0               && !edgeHasWall(gs, x, y, 'N')) out.push([x, y-1]);
  return out;
}

/**
 * Build a pathing grid view for the current game state.
 * isFree() is tile-level (don’t over-block). neighbors4() filters by walls.
 */
// ⬇️ Add in grid/api.js
export function createPathGrid(gs) {
  const cols = state.GRID.cols, rows = state.GRID.rows;

  const inBounds = (x, y) => (x >= 0 && x < cols && y >= 0 && y < rows);

  // Passable rule: everything in-bounds is passable EXCEPT dragon footprint…
  // …but EXIT itself is *always* passable so BFS can seed from it.
  const isPassable = (x, y) => {
    if (!inBounds(x, y)) return false;
    const onDragon = typeof state.isDragonCell === 'function' && state.isDragonCell(x, y, gs);
    const isExit   = (x === state.EXIT.x && y === state.EXIT.y);
    return isExit || !onDragon;
  };

  const neighbors4 = (x, y) => {
    const out = [];
    // From (x,y), you may step into (nx,ny) only if the shared edge has no wall.
    const DIRS = [
      ['E',  1,  0],
      ['W', -1,  0],
      ['S',  0,  1],
      ['N',  0, -1],
    ];
    for (const [side, dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (!isPassable(nx, ny)) continue;
      // Blocked if there is a wall on the edge we’re about to cross
      if (edgeHasWall(gs, x, y, side)) continue;
      out.push([nx, ny]);
    }
    return out;
  };

  return {
    cols,
    rows,
    inBounds,
    isFree: isPassable,   // adapter name used by directpath
    neighbors4,
  };
}


/**
 * @typedef {Object} GridApi
 * @property {number} cols
 * @property {number} rows
 * @property {(x:number, y:number)=>boolean} inBounds
 * @property {(x:number, y:number)=>boolean} isFree
 * @property {(x:number, y:number)=>Array<[number,number]>} neighbors4
 */

/**
 * Create a 4-way grid API.
 * Provide exactly one of: blockedSet, blockedGrid, or passable.
 *
 * @param {Object} opts
 * @param {number} opts.cols
 * @param {number} opts.rows
 * @param {Set<string>}   [opts.blockedSet]  // keys as "x,y"
 * @param {boolean[][]}   [opts.blockedGrid] // blockedGrid[y][x] === true means blocked
 * @param {(x:number,y:number)=>boolean} [opts.passable] // return true if tile is passable
 * @returns {GridApi}
 */
export function createGridApi(opts) {
  const { cols, rows, blockedSet, blockedGrid, passable } = optsAssert(opts);

  const inBounds = (x, y) => (x >= 0 && x < cols && y >= 0 && y < rows);

  let isFree;
  if (typeof passable === 'function') {
    // Custom predicate defines passability (must also respect bounds).
    isFree = (x, y) => inBounds(x, y) && !!passable(x, y);
  } else if (blockedSet instanceof Set) {
    isFree = (x, y) => inBounds(x, y) && !blockedSet.has(key(x, y));
  } else if (Array.isArray(blockedGrid)) {
    isFree = (x, y) => inBounds(x, y) && !Boolean(blockedGrid[y][x]);
  } else {
    // Should never happen due to optsAssert, but keep a safe default.
    isFree = (x, y) => inBounds(x, y);
  }

  const neighbors4 = (x, y) => {
    // Returns only passable, in-bounds neighbors (E, W, S, N).
    const out = [];
    for (let i = 0; i < 4; i++) {
      const nx = x + DIR4[i][0];
      const ny = y + DIR4[i][1];
      if (isFree(nx, ny)) out.push([nx, ny]);
    }
    return out;
  };

  return {
    cols,
    rows,
    inBounds,
    isFree,
    neighbors4,
  };
}

/**
 * Utility: build a "x,y" key for sets/maps.
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function key(x, y) {
  return `${x},${y}`;
}

function _ensureCell(gs, x, y) {
  if (typeof state.ensureCell === 'function') return state.ensureCell(gs, x, y);
  // ultra-defensive fallback
  gs.grid = gs.grid || Array.from({ length: state.GRID.rows }, () =>
    Array.from({ length: state.GRID.cols }, () => ({ N:0, E:0, S:0, W:0 }))
  );
  return gs.grid[y][x];
}

/**
 * Return true if there is a wall on the given edge of (x,y).
 * Accounts for shared edges (e.g., (x,y).N === (x,y-1).S).
 */
export function edgeHasWall(gs, x, y, side) {
  if (x < 0 || y < 0 || x >= state.GRID.cols || y >= state.GRID.rows) return false;

  const rec = _ensureCell(gs, x, y);
  switch (side) {
    case 'N': return !!(rec.N || (y > 0 && _ensureCell(gs, x, y - 1).S));
    case 'S': return !!(rec.S || (y < state.GRID.rows - 1 && _ensureCell(gs, x, y + 1).N));
    case 'W': return !!(rec.W || (x > 0 && _ensureCell(gs, x - 1, y).E));
    case 'E': return !!(rec.E || (x < state.GRID.cols - 1 && _ensureCell(gs, x + 1, y).W));
    default:  return false;
  }
}

// ---- write: toggle an edge and mirror its neighbor edge ----
export function toggleEdge(gs, x, y, side) {
  if (!state.inBounds(x, y)) return false;
  const rec = _ensureCell(gs, x, y);
  let changed = false;

  const flip = (obj, k) => { obj[k] = obj[k] ? 0 : 1; changed = true; };

  if (side === 'N') {
    flip(rec, 'N');
    if (y > 0) flip(_ensureCell(gs, x, y - 1), 'S');
  } else if (side === 'S') {
    flip(rec, 'S');
    if (y < state.GRID.rows - 1) flip(_ensureCell(gs, x, y + 1), 'N');
  } else if (side === 'W') {
    flip(rec, 'W');
    if (x > 0) flip(_ensureCell(gs, x - 1, y), 'E');
  } else if (side === 'E') {
    flip(rec, 'E');
    if (x < state.GRID.cols - 1) flip(_ensureCell(gs, x + 1, y), 'W');
  }

  // Notify systems that depend on topology
  if (changed && typeof state.bumpTopology === 'function') {
    state.bumpTopology(gs);
  }
  return changed;
}

/**
 * Option validation & normalization.
 * @param {Object} opts
 * @private
 */
function optsAssert(opts) {
  if (!opts || typeof opts.cols !== 'number' || typeof opts.rows !== 'number') {
    throw new Error('createGridApi: { cols:number, rows:number } are required.');
  }
  const { cols, rows, blockedSet, blockedGrid, passable } = opts;

  const provided =
    (blockedSet instanceof Set ? 1 : 0) +
    (Array.isArray(blockedGrid) ? 1 : 0) +
    (typeof passable === 'function' ? 1 : 0);

  if (provided !== 1) {
    throw new Error('createGridApi: provide exactly one of { blockedSet, blockedGrid, passable }.');
  }

  // Light sanity checks for blockedGrid dimensions (if provided).
  if (Array.isArray(blockedGrid)) {
    if (blockedGrid.length !== rows) {
      throw new Error(`createGridApi: blockedGrid has ${blockedGrid.length} rows, expected ${rows}.`);
    }
    for (let y = 0; y < rows; y++) {
      if (!Array.isArray(blockedGrid[y]) || blockedGrid[y].length !== cols) {
        throw new Error(`createGridApi: blockedGrid row ${y} has ${blockedGrid[y]?.length} cols, expected ${cols}.`);
      }
    }
  }

  return { cols, rows, blockedSet, blockedGrid, passable };
}
