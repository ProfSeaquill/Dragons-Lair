// pathing/navigator.js
// Choose the next 4-way step for an agent using the precomputed DirectPath,
// soft-occupancy signals, and human-like tie-breaks (keep heading, mild bias,
// tiny randomness). Works on static, uniform-cost, 4-way grids.
//
// Expects:
//   - directpath.js: buildDirectPath(), getBestDirs(), getDist(), DIR4, stepInDir()
//   - grid/api.js:   neighbors4(x,y), isFree(x,y)
//   - occupancy.js:  isSoftBlocked(occ,x,y,cap)
//
// Agent shape (minimal):
//   { id:number|string, x:number, y:number, heading?:Dir }
//
// Public API:
//   DEFAULT_OPTS
//   createRNG(seed?:number) -> () => number
//   chooseNextStep(agent, dp, grid, occ, opts?) -> { nx, ny, dir } | null
//
// Notes:
// - If downhill dirs exist, we rank among them. If none exist (should be rare
//   unless at EXIT or temporarily boxed by units), we consider all passable
//   neighbors and pick the one with smallest distance.
// - "Soft-blocked" tiles are discouraged but not forbidden, so groups can still
//   squeeze through narrow corridors.
// - All tie-breaks are small *biases*, not hard rules, to keep behavior robust.

import { DIR4, getBestDirs, getDist, stepInDir } from './directpath.js';

/** @typedef {0|1|2|3} Dir */

export const DEFAULT_OPTS = {
  // If true, add a penalty when a candidate tile is soft-blocked (over cap).
  avoidSoftBlocked: true,
  softCap: 3,                 // occupancy cap used by occ.isSoftBlocked
  softPenalty: 1.0,           // additive penalty when over cap

  // Heading continuity & turn preferences (applied when agent.heading is defined)
  headingStick: 0.35,         // subtract on "straight" (encourage straight ahead)
  backPenalty: 0.6,           // add on "about-face" (discourage doubling back)
  rightBias: 0.05,            // subtract if the turn is a right turn
  leftBias: 0.00,             // subtract if the turn is a left turn (0 by default)

  // Random tie-breaker jitter (seedable via opts.rng)
  randJitter: 0.06,           // add uniform(-randJitter/2 .. +randJitter/2)
  rng: null,                  // optional function () => [0,1)
};

/**
 * Deterministic RNG if needed. Mulberry32 variant.
 * @param {number} seed
 */
export function createRNG(seed = 123456789) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Choose the next step for the agent.
 * @param {{id:number|string, x:number, y:number, heading?:Dir}} agent
 * @param {import('./directpath.js').DirectPath} dp
 * @param {{neighbors4:(x:number,y:number)=>Array<[number,number]>, isFree:(x:number,y:number)=>boolean}} grid
 * @param {{isSoftBlocked:(occ:any,x:number,y:number,cap:number)=>boolean}} occ
 * @param {Partial<typeof DEFAULT_OPTS>} [optsIn]
 * @returns {{nx:number, ny:number, dir:Dir} | null}
 */
export function chooseNextStep(agent, dp, grid, occ, optsIn) {
  const opts = { ...DEFAULT_OPTS, ...optsIn };
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;

  const x = agent.x | 0, y = agent.y | 0;
  const downhill = getBestDirs(dp, x, y);

  /** @type {Array<{dir:Dir, nx:number, ny:number, score:number}>} */
  let candidates = [];

  if (downhill.length > 0) {
    for (let i = 0; i < downhill.length; i++) {
      const dir = downhill[i];
      const [nx, ny] = stepInDir(x, y, dir);
      if (!grid.isFree(nx, ny)) continue; // defensive (should be free if downhill)
      candidates.push({ dir, nx, ny, score: 0 });
    }
  } else {
    // No downhill options (at EXIT or an odd corner case). Consider all passable neighbors.
    const ns = grid.neighbors4(x, y);
    if (ns.length === 0) return null; // completely stuck (shouldn't happen on valid maps)
    // Rank by distance (ascending).
    let bestD = Infinity;
    for (let k = 0; k < ns.length; k++) {
      const [nx, ny] = ns[k];
      const d = getDist(dp, nx, ny);
      if (!isFinite(d)) continue; // unreachable neighbor (should be rare)
      bestD = Math.min(bestD, d);
      // We'll compute full score below with biases
      const dir = dirFromDelta(x, y, nx, ny);
      candidates.push({ dir, nx, ny, score: d });
    }
    // Normalize base score relative to the best distance among neighbors
    for (let c of candidates) {
      c.score = c.score - bestD; // 0 for the best dist, positive otherwise
    }
  }

  if (candidates.length === 0) return null;

  // Apply human-like tie-breakers (small biases)
  for (let c of candidates) {
    // Soft occupancy discouragement
    if (opts.avoidSoftBlocked && occ && occ.isSoftBlocked && occ.isSoftBlocked(occ, c.nx, c.ny, opts.softCap)) {
      c.score += opts.softPenalty;
    }

    // Heading continuity & turn preference
    if (agent.heading !== undefined && agent.heading !== null) {
      const turn = turnKind(/** @type {Dir} */(agent.heading), c.dir);
      if (turn === 'straight') {
        c.score -= opts.headingStick;
      } else if (turn === 'back') {
        c.score += opts.backPenalty;
      } else if (turn === 'right') {
        c.score -= opts.rightBias;
      } else if (turn === 'left') {
        c.score -= opts.leftBias;
      }
    }

    // Tiny random jitter for de-synced choices
    if (opts.randJitter > 0) {
      c.score += (rng() - 0.5) * opts.randJitter;
    }
  }

  // Pick min score
  candidates.sort((a, b) => a.score - b.score);
  const choice = candidates[0];

  return { nx: choice.nx, ny: choice.ny, dir: choice.dir };
}

/**
 * Compute the 4-way direction code from (x,y)->(nx,ny).
 * @throws on invalid (non 4-way) delta.
 */
function dirFromDelta(x, y, nx, ny) {
  const dx = nx - x, dy = ny - y;
  for (let i = 0; i < 4; i++) {
    if (DIR4[i][0] === dx && DIR4[i][1] === dy) return /** @type {Dir} */(i);
  }
  throw new Error(`dirFromDelta: invalid neighbor delta (${dx},${dy}).`);
}

/**
 * Turn classification relative to previous heading.
 * Returns 'straight' | 'right' | 'left' | 'back'
 * (assuming DIR4 order: 0=E,1=W,2=S,3=N)
 * We map turns on a circular axis with CW/CCW.
 *
 * @param {Dir} prev
 * @param {Dir} next
 */
function turnKind(prev, next) {
  // Map E,W,S,N to angle steps: E=0, S=1, W=2, N=3 (clockwise order)
  // Our DIR4 is [E,W,S,N]; we want CW order, so remap:
  const cwMap = [0, 2, 1, 3]; // dir -> cw step index
  const a = cwMap[prev];
  const b = cwMap[next];
  const delta = (b - a + 4) % 4;
  if (delta === 0) return 'straight';
  if (delta === 1) return 'right';
  if (delta === 3) return 'left';
  return 'back'; // delta === 2
}
