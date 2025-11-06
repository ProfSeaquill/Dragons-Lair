// pathing/memory.js
// Deterministic junction memory for randomized DFS-style search.
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - Determinism:     Set the RNG seed per unit for replayable behavior.
//                    See setSeed() / createMemory(seed).
// - "Explored" rule: We track explored **edges** (ax,ay -> bx,by).
//                    Call markEdgeExplored() when you step from A to B.
//                    TUNABLE: Only mark after you reach the far junction if
//                    you want to count the *whole corridor* as explored.
// - Junction choice: Choose uniformly among exits whose **edge** isn't visited,
//                    excluding the back edge. Store the random pick on the
//                    breadcrumb so revisits won't re-roll.
// - Breadcrumb fanout: We store the remaining exits as a bitmask; tweak how
//                    aggressively the FSM consumes it (FSM concern).
// ──────────────────────────────────────────────────────────────────────────────

//// Direction bit masks (4-connected) //////////////////////////////////////////
// Bit layout (fixed for portability): N=1<<0, E=1<<1, S=1<<2, W=1<<3
export const DIR_BITS = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
export const BITS_DIR = Object.freeze({ 1: "N", 2: "E", 4: "S", 8: "W" });
const OPP = { N: "S", S: "N", E: "W", W: "E" };

export function dirToBit(dir) { return DIR_BITS[dir] || 0; }
export function bitToDir(bit) { return BITS_DIR[bit] || null; }

export function maskHas(mask, dir) { return (mask & dirToBit(dir)) !== 0; }
export function maskAdd(mask, dir) { return mask | dirToBit(dir); }
export function maskRemove(mask, dir) { return mask & ~dirToBit(dir); }

/** Build a mask from an array like ["N","E"] */
export function maskFromDirs(dirs) {
  let m = 0;
  for (const d of dirs) m |= dirToBit(d);
  return m;
}

/** Iterate bits in a mask as direction strings in N,E,S,W order (deterministic). */
export function* dirsFromMask(mask) {
  if (mask & DIR_BITS.N) yield "N";
  if (mask & DIR_BITS.E) yield "E";
  if (mask & DIR_BITS.S) yield "S";
  if (mask & DIR_BITS.W) yield "W";
}

//// Deterministic RNG (xorshift32) /////////////////////////////////////////////
// Small, fast, portable. Store state on the memory object for replayability.
function xorshift32(state) {
  // Ensure uint32
  let x = state >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x << 17; x >>>= 0;
  x ^= x << 5;  x >>>= 0;
  return x >>> 0;
}

function makeRng(seed) {
  let s = (seed >>> 0) || 0x9E3779B9; // golden ratio default
  return {
    nextU32() { s = xorshift32(s); return s; },
    nextFloat() { return (this.nextU32() >>> 8) / 0x01000000; }, // [0,1)
    setSeed(v) { s = (v >>> 0) || 1; }
  };
}

//// Memory object //////////////////////////////////////////////////////////////
// Structure:
//   mem = {
//     rng,                 // deterministic RNG
//     edges: Set<string>,  // "ax,ay->bx,by" (directed)
//     stack: [Breadcrumb]  // LIFO of junction decisions
//   }
//
// Breadcrumb = {
//   jx, jy,                // junction tile
//   backDir,               // dir we came from into this junction
//   chosen,                // dir we chose originally (sticky randomness)
//   remainingMask,         // bitmask of exits left to try from this junction
// }

export function createMemory(seed = 0xCAFEBABE) {
  return {
    rng: makeRng(seed),
    edges: new Set(),
    stack: []
  };
}

export function setSeed(mem, seed) {
  mem.rng.setSeed(seed);
}

//// Edge exploration tracking //////////////////////////////////////////////////

function edgeKey(ax, ay, bx, by) { return `${ax},${ay}->${bx},${by}`; }

/** Mark a directed edge (A->B) as explored. Call when stepping from A to B.
 *  TUNABLE: If you prefer marking after confirming the far end (e.g., only
 *  once you hit the next junction/dead end), delay this call until then.
 */
export function markEdgeExplored(mem, ax, ay, bx, by) {
  mem.edges.add(edgeKey(ax, ay, bx, by));
}

/** Has the directed edge (A->B) been explored already? */
export function isEdgeExplored(mem, ax, ay, bx, by) {
  return mem.edges.has(edgeKey(ax, ay, bx, by));
}

//// Breadcrumb stack (junction memory) /////////////////////////////////////////

/** Push a breadcrumb at junction (jx,jy).
 *  - backDir: direction we arrived from (exclude it from options).
 *  - exits:   array of candidate dirs (e.g., ["N","E","S","W"] filtered by passability).
 *  - posX,posY: current tile; used to filter edges already explored (A->B).
 *
 *  This will randomly choose one *unexplored* exit (if any), store it as `chosen`,
 *  and leave the rest in `remainingMask`. If all exits are explored, `chosen` can be null.
 *
 *  Returns { chosenDir, hasRemaining }.
 */
export function pushBreadcrumb(mem, jx, jy, backDir, exits, posX, posY) {
  // 1) Build candidate mask: exits minus backDir and minus edges already explored
  let mask = 0;
  for (const d of exits) {
    if (d === backDir) continue;
    const [nx, ny] = stepFrom(posX, posY, d);
    if (!isEdgeExplored(mem, posX, posY, nx, ny)) {
      mask |= dirToBit(d);
    }
  }

  // 2) Choose uniformly among remaining (sticky randomness)
  let chosen = null;
  if (mask !== 0) {
    const dirs = Array.from(dirsFromMask(mask));
    const idx = Math.floor(mem.rng.nextFloat() * dirs.length);
    chosen = dirs[idx];
    // remaining excludes chosen
    mask = maskRemove(mask, chosen);
  }

  const crumb = { jx, jy, backDir: backDir || null, chosen, remainingMask: mask };
  mem.stack.push(crumb);
  return { chosenDir: chosen, hasRemaining: mask !== 0 };
}

/** Return the top breadcrumb (or null). */
export function peekBreadcrumb(mem) {
  const n = mem.stack.length;
  return n ? mem.stack[n - 1] : null;
}

/** Pop the top breadcrumb. */
export function popBreadcrumb(mem) {
  return mem.stack.pop() || null;
}

/** From the current breadcrumb, get the next untried exit uniformly at random.
 *  Also updates the breadcrumb to remove the chosen exit from remainingMask.
 *  Returns a direction string or null if none remain.
 */
export function nextUntriedExit(mem) {
  const top = peekBreadcrumb(mem);
  if (!top || top.remainingMask === 0) return null;

  const dirs = Array.from(dirsFromMask(top.remainingMask));
  const idx = Math.floor(mem.rng.nextFloat() * dirs.length);
  const pick = dirs[idx];
  top.remainingMask = maskRemove(top.remainingMask, pick);
  return pick;
}

/** Clear all memory (fresh unit / fresh round). */
export function resetMemory(mem) {
  mem.edges.clear();
  mem.stack.length = 0;
}

//// Small helpers //////////////////////////////////////////////////////////////

/** Compute next grid coord from (x,y) taking dir "N","E","S","W". */
export function stepFrom(x, y, dir) {
  switch (dir) {
    case "N": return [x, y - 1];
    case "E": return [x + 1, y];
    case "S": return [x, y + 1];
    case "W": return [x - 1, y];
    default:  return [x, y];
  }
}

/** Convenience: record both directions as explored (undirected sense). */
export function markCorridorBothWays(mem, ax, ay, bx, by) {
  markEdgeExplored(mem, ax, ay, bx, by);
  markEdgeExplored(mem, bx, by, ax, ay);
}

/** True if a direction bitmask has no options left. */
export function maskEmpty(mask) { return (mask | 0) === 0; }
