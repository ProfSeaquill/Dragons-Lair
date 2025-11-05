// pathing/directpath.js
// Precompute a downhill distance field from the EXIT and expose helpers
// to pick best 4-way moves that monotonically decrease distance.
// Static per run; perfect for uniform-cost, 4-way grids.
//
// Expected grid API (from grid/api.js):
//   grid.cols, grid.rows
//   grid.inBounds(x,y) -> boolean
//   grid.isFree(x,y)   -> boolean
//   grid.neighbors4(x,y) -> Array<[nx,ny]>
//
// Public API:
//   buildDirectPath(exitX, exitY, grid) -> DirectPath
//   getDist(dp, x, y) -> number (Infinity if unreachable)
//   getBestDirs(dp, x, y) -> Array<Dir>  // one or more downhill directions
//   encodeDir(dx, dy) -> Dir
//   stepInDir(x, y, dir) -> [nx, ny]
//   DIR4 (ordered: East, West, South, North)
//
// Note: We keep this module strictly about distances/directions.
// Tie-breaking (e.g., preserve heading, RNG) should live in follower logic.

export const DIR4 = [
  [ 1, 0], // 0: East
  [-1, 0], // 1: West
  [ 0, 1], // 2: South
  [ 0,-1], // 3: North
];

/**
 * @typedef {0|1|2|3} Dir
 */

/**
 * @typedef {Object} DirectPath
 * @property {number} cols
 * @property {number} rows
 * @property {number[]} dist           // length = cols*rows, Infinity if unreachable
 * @property {Uint8Array} bestMask     // 4-bit mask of downhill directions per cell (bit i set if DIR4[i] is best)
 * @property {(x:number,y:number)=>number} idx
 * @property {(i:number)=>[number,number]} xy
 * @property {[number,number]} exit
 */

/**
 * Build the precomputed downhill field from a single exit.
 * BFS from exit across passable cells (uniform cost = 1 per step).
 *
 * @param {number} exitX
 * @param {number} exitY
 * @param {{cols:number, rows:number, isFree:(x:number,y:number)=>boolean, neighbors4:(x:number,y:number)=>Array<[number,number]>, inBounds:(x:number,y:number)=>boolean}} grid
 * @returns {DirectPath}
 */
export function buildDirectPath(exitX, exitY, grid) {
  const { cols, rows } = grid;
  const size = cols * rows;
  const dist = new Array(size).fill(Infinity);
  const bestMask = new Uint8Array(size); // 4-bit bitset; computed after BFS

  const idx = (x, y) => y * cols + x;
  const xy  = (i) => [i % cols, (i / cols) | 0];

  if (!grid.inBounds(exitX, exitY) || !grid.isFree(exitX, exitY)) {
    throw new Error(`buildDirectPath: EXIT (${exitX},${exitY}) is out of bounds or blocked.`);
  }

  // --- BFS queue (array used as ring buffer) ---
  const qx = new Int32Array(size);
  const qy = new Int32Array(size);
  let qh = 0, qt = 0;

  // Seed with exit
  dist[idx(exitX, exitY)] = 0;
  qx[qt] = exitX; qy[qt] = exitY; qt++;

  console.debug('[dp] seed exit', exitX, exitY, 'free?', grid.isFree(exitX, exitY));

  while (qh !== qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    const d = dist[idx(x, y)];
    const ns = grid.neighbors4(x, y);
    for (let k = 0; k < ns.length; k++) {
      const nx = ns[k][0], ny = ns[k][1];
      const ni = idx(nx, ny);
      if (!grid.isFree(nx, ny)) continue;
      if (dist[ni] === Infinity) {
        dist[ni] = d + 1;
        qx[qt] = nx; qy[qt] = ny; qt++;
      }
    }
  }

  // Compute downhill masks: For each cell, flag neighbor dirs whose dist == dist[cell]-1
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y);
      const d = dist[i];
      if (!isFinite(d) || d === 0) {
        // Unreachable or exit: mask stays 0 (no downhill)
        continue;
      }
      let mask = 0;
      // E, W, S, N
      const e = [x + 1, y];
      const w = [x - 1, y];
      const s = [x, y + 1];
      const n = [x, y - 1];

      // East
      if (x + 1 < cols && dist[idx(e[0], e[1])] === d - 1) mask |= (1 << 0);
      // West
      if (x - 1 >= 0   && dist[idx(w[0], w[1])] === d - 1) mask |= (1 << 1);
      // South
      if (y + 1 < rows && dist[idx(s[0], s[1])] === d - 1) mask |= (1 << 2);
      // North
      if (y - 1 >= 0   && dist[idx(n[0], n[1])] === d - 1) mask |= (1 << 3);

      bestMask[i] = mask;
    }
  }

  return {
    cols, rows, dist, bestMask, idx, xy, exit: [exitX, exitY],
  };
}

/**
 * Distance to exit from (x,y). Infinity if unreachable.
 * @param {DirectPath} dp
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function getDist(dp, x, y) {
  if (x < 0 || x >= dp.cols || y < 0 || y >= dp.rows) return Infinity;
  return dp.dist[dp.idx(x, y)];
}

/**
 * Return all downhill directions (as Dir codes 0..3)
 * that decrease distance by exactly 1 step.
 * If none, returns [].
 *
 * The order here is fixed (E, W, S, N). Apply your own
 * tie-breaking in follower logic if you want e.g. “keep heading.”
 *
 * @param {DirectPath} dp
 * @param {number} x
 * @param {number} y
 * @returns {Dir[]}
 */
export function getBestDirs(dp, x, y) {
  if (x < 0 || x >= dp.cols || y < 0 || y >= dp.rows) return [];
  const mask = dp.bestMask[dp.idx(x, y)];
  if (!mask) return [];
  const out = [];
  // Bits: 0=E,1=W,2=S,3=N
  if (mask & (1 << 0)) out.push(0);
  if (mask & (1 << 1)) out.push(1);
  if (mask & (1 << 2)) out.push(2);
  if (mask & (1 << 3)) out.push(3);
  return out;
}

/**
 * Encode a 4-way direction from (dx,dy) to Dir code 0..3.
 * Throws if not a valid 4-way vector.
 * @param {number} dx
 * @param {number} dy
 * @returns {Dir}
 */
export function encodeDir(dx, dy) {
  for (let i = 0; i < 4; i++) {
    if (DIR4[i][0] === dx && DIR4[i][1] === dy) return /** @type {Dir} */(i);
  }
  throw new Error(`encodeDir: invalid dir (${dx},${dy}); expected one of DIR4.`);
}

/**
 * Step from (x,y) in a 4-way Dir (0..3) and return [nx,ny].
 * @param {number} x
 * @param {number} y
 * @param {Dir} dir
 * @returns {[number,number]}
 */
export function stepInDir(x, y, dir) {
  const d = DIR4[dir];
  return [x + d[0], y + d[1]];
}
