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

const DIR4 = [
  [ 1, 0],  // East
  [-1, 0],  // West
  [ 0, 1],  // South
  [ 0,-1],  // North
];

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
