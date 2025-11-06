// grid/walls.js
// 4-connected grid topology + wall management (engine-agnostic)
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - Grid size:          call initGrid(cols, rows) once at startup.
//                       If you know pixels & tile size: cols = width_px / tile_px,
//                       rows = height_px / tile_px. (Use integers.)
// - Neighbor order:     neighbors4() returns N,E,S,W (deterministic).
//                       You can re-order if you want different tie-breaks.
// - Junction rule:      isJunction(): by default, a tile is a junction if
//                       (a) it has ≥3 passable neighbors, OR
//                       (b) excluding the back edge, it has ≥2 forward options.
//                       See the "TUNABLE: Junction rule" comments to adjust.
// - ASCII preview:      toAscii(maxW,maxH) width/height caps for debugging only.
// ──────────────────────────────────────────────────────────────────────────────

//// Internal state /////////////////////////////////////////////////////////////

let COLS = 0;
let ROWS = 0;
// Store blocked tiles as "x,y" in a Set for O(1) queries.
const WALLS = new Set();

// TUNABLE: Neighbor iteration order.
// Reorder to change deterministic tie-break behavior across the system.
// e.g., ["E","N","W","S"] would prefer moving east first where choices are equal.
const DIRS = /** @type {const} */ (["N", "E", "S", "W"]);
const OPP = { N: "S", S: "N", E: "W", W: "E" };

//// Basic grid & wall API //////////////////////////////////////////////////////

/** Initialize or resize the grid. Clears all walls.
 *  TUNABLE: Call this with your tile counts (not pixels).
 *  Example: width_px=768, tile_px=32 => cols=24; height_px=512 => rows=16.
 */
export function initGrid(cols, rows) {
  if (!Number.isInteger(cols) || cols <= 0) throw new Error("initGrid: cols must be +int");
  if (!Number.isInteger(rows) || rows <= 0) throw new Error("initGrid: rows must be +int");
  COLS = cols; ROWS = rows;
  WALLS.clear();
}

/** Columns count. */
export function cols() { return COLS; }
/** Rows count. */
export function rows() { return ROWS; }

/** Key helper. */
export function key(x, y) { return `${x},${y}`; }

/** Bounds check. */
export function inBounds(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

/** Is tile passable (in bounds and not a wall)? */
export function isPassable(x, y) {
  return inBounds(x, y) && !WALLS.has(key(x, y));
}

/** Set or clear a wall at (x,y).
 *  TUNABLE: If you support build modes between rounds, wire your UI to call this.
 */
export function setWall(x, y, blocked = true) {
  if (!inBounds(x, y)) return false;
  const k = key(x, y);
  if (blocked) { WALLS.add(k); } else { WALLS.delete(k); }
  return true;
}

/** Toggle a wall at (x,y). Handy for editors/dev panels. */
export function toggleWall(x, y) {
  if (!inBounds(x, y)) return false;
  const k = key(x, y);
  if (WALLS.has(k)) WALLS.delete(k); else WALLS.add(k);
  return true;
}

/** Remove all walls (e.g., start of a new level). */
export function clearAllWalls() { WALLS.clear(); }

/** Export walls as an array of [x,y] pairs (useful for saving). */
export function exportWalls() {
  const out = [];
  for (const k of WALLS) {
    const [x, y] = k.split(",").map(n => parseInt(n, 10));
    out.push([x, y]);
  }
  return out;
}

/**
 * Load walls from a 2D array (rows × cols) of booleans/0-1.
 * Truthy => wall, falsy => empty. Clears existing walls.
 * TUNABLE: If your data is [cols][rows] instead of [rows][cols], swap the loops.
 */
export function loadWallsArray(rowsArray) {
  if (!Array.isArray(rowsArray) || rowsArray.length === 0) throw new Error("loadWallsArray: invalid array");
  const R = rowsArray.length;
  const C = rowsArray[0].length;
  initGrid(C, R);
  for (let y = 0; y < R; y++) {
    const row = rowsArray[y];
    if (!Array.isArray(row) || row.length !== C) throw new Error("loadWallsArray: ragged rows");
    for (let x = 0; x < C; x++) {
      if (row[x]) WALLS.add(key(x, y));
    }
  }
}

//// Topology helpers (4-connected) ////////////////////////////////////////////

/** 4-way neighbors in deterministic order.
 *  TUNABLE: Change the DIRS order above to alter tie-breaks globally.
 */
export function neighbors4(x, y) {
  const n = [];
  // Keep the push order aligned with DIRS for predictability
  if (isPassable(x, y - 1)) n.push({ x, y: y - 1, dir: "N" }); // N
  if (isPassable(x + 1, y)) n.push({ x: x + 1, y, dir: "E" }); // E
  if (isPassable(x, y + 1)) n.push({ x, y: y + 1, dir: "S" }); // S
  if (isPassable(x - 1, y)) n.push({ x: x - 1, y, dir: "W" }); // W
  return n;
}

/** Count of passable neighbors (degree). */
export function degree(x, y) { return neighbors4(x, y).length; }

/**
 * Is this tile a *junction* for decision-making?
 *
 * Default rule (good for human-like choices without over-triggering):
 *   - If there are ≥3 passable neighbors, it's a junction.
 *   - Else, if we exclude the back edge (where we came from),
 *     and there are ≥2 "forward" options, it's a junction.
 *
 * TUNABLE: Junction rule
 *   - More conservative (fewer junctions): require ≥3 neighbors ONLY.
 *   - More eager (more junctions): treat any case with 2 forward options
 *     OR even a single fork away from straight as a junction.
 *
 * prevDir is the direction we moved to arrive here ("N","E","S","W").
 */
export function isJunction(x, y, prevDir) {
  const opts = neighbors4(x, y);
  if (opts.length <= 1) return false;          // dead end or isolated
  if (!prevDir) return opts.length >= 3;       // at spawn/unknown, use ≥3
  const forward = opts.filter(o => o.dir !== OPP[prevDir]);
  // TUNABLE: change the ">= 2" below to ">= 1" to trigger decisions more often.
  if (forward.length >= 2) return true;        // ≥2 choices forward = junction
  return opts.length >= 3;                      // fallback
}

/** Next straight step given prevDir; null if blocked or no prevDir.
 *  Use this to keep corridors "straight" (no decision) through gentle bends.
 */
export function stepStraight(x, y, prevDir) {
  switch (prevDir) {
    case "N": return isPassable(x, y - 1) ? { x, y: y - 1, dir: "N" } : null;
    case "E": return isPassable(x + 1, y) ? { x: x + 1, y, dir: "E" } : null;
    case "S": return isPassable(x, y + 1) ? { x, y: y + 1, dir: "S" } : null;
    case "W": return isPassable(x - 1, y) ? { x: x - 1, y, dir: "W" } : null;
    default: return null;
  }
}

/** Direction label from (ax,ay) to (bx,by); returns "N","E","S","W" or null. */
export function dirFromTo(ax, ay, bx, by) {
  if (bx === ax && by === ay - 1) return "N";
  if (bx === ax + 1 && by === ay) return "E";
  if (bx === ax && by === ay + 1) return "S";
  if (bx === ax - 1 && by === ay) return "W";
  return null;
}

/** Allowed forward options excluding the back edge, in N,E,S,W order.
 *  TUNABLE: If you want left-hand/right-hand preference, reorder results here.
 */
export function forwardOptions(x, y, prevDir) {
  const back = OPP[prevDir];
  return neighbors4(x, y).filter(n => n.dir !== back);
}

/** Is this tile a dead end (≤1 neighbor)? */
export function isDeadEnd(x, y) { return degree(x, y) <= 1; }

//// Debug conveniences /////////////////////////////////////////////////////////

/** String sketch of the grid (optional): "." empty, "#" wall.
 *  TUNABLE: Pass maxW/maxH to crop big maps in console prints.
 */
export function toAscii(maxW = COLS, maxH = ROWS) {
  let out = "";
  for (let y = 0; y < Math.min(ROWS, maxH); y++) {
    for (let x = 0; x < Math.min(COLS, maxW); x++) {
      out += WALLS.has(key(x, y)) ? "#" : ".";
    }
    out += "\n";
  }
  return out;
}
