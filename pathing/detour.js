// pathing/detour.js
// Minimal Pledge-style detour for 4-way grids.
// - Enter when downhill candidates are all "soft-blocked" (crowded).
// - Wall-follow (right-hand by default) for a few steps to slip around the crowd.
// - Exit detour when (a) net turn sum returns to 0 and (b) desired heading is clear.
//
// DIR convention matches directpath.js: 0=E, 1=W, 2=S, 3=N
//
// Public API:
//   DEFAULT_DETOUR_OPTS
//   startDetour(agent, desiredDir, opts?)
//   detourStep(agent, grid, occ?) -> { nx, ny, dir, done } | null
//
// Agent requirements (adds internal state at `agent._detour`):
//   { id, x, y, heading?:Dir, _detour?: { active, desired, facing, sum, steps, wallSide, maxSteps } }
//
// Notes:
// - This module does no distance math; it only picks a local step.
// - It ignores "soft-blocked" in movement checks (detours should punch through narrow spots).
// - If absolutely no neighbor is free (shouldn’t happen on valid maps), returns null.

import { DIR4, stepInDir } from './directpath.js';

/** @typedef {0|1|2|3} Dir */

export const DEFAULT_DETOUR_OPTS = {
  wallSide: 'right',   // 'right' or 'left'
  maxSteps: 2,         // detour for up to N steps before handing control back
};

/**
 * Begin a detour for an agent.
 * @param {{id:any, x:number, y:number, heading?:Dir}} agent
 * @param {Dir} desiredDir   // the heading you'd like to be going (toward EXIT)
 * @param {Partial<typeof DEFAULT_DETOUR_OPTS>} [optsIn]
 */
export function startDetour(agent, desiredDir, optsIn) {
  const opts = { ...DEFAULT_DETOUR_OPTS, ...optsIn };
  /** @type {Dir} */
  const facing = (agent.heading ?? desiredDir);
  agent._detour = {
    active: true,
    desired: desiredDir,
    facing,
    sum: 0,           // net quarter-turns: right=+1, left=-1, back=±2
    steps: 0,
    wallSide: (opts.wallSide === 'left' ? 'left' : 'right'),
    maxSteps: Math.max(1, opts.maxSteps | 0),
  };
}

/**
 * Take one detour step (Pledge-style). Returns the move and whether detour is done.
 * @param {{id:any, x:number, y:number, heading?:Dir, _detour?:any}} agent
 * @param {{isFree:(x:number,y:number)=>boolean}} grid
 * @param {any} [occ] // unused; present for future soft/crowd-aware detours
 * @returns {{ nx:number, ny:number, dir:Dir, done:boolean } | null}
 */
export function detourStep(agent, grid, occ) {
  const st = agent._detour;
  if (!st || !st.active) return null;

  const x = agent.x | 0, y = agent.y | 0;

  // Exit condition for Pledge: net turns back to 0 AND desired heading is clear.
  if (st.sum === 0 && isClearAhead(x, y, st.desired, grid)) {
    st.active = false;
    const [nx, ny] = stepInDir(x, y, st.desired);
    agent.heading = st.desired;
    return { nx, ny, dir: st.desired, done: true };
  }

  // Hard cap on detour length: after maxSteps, stop detouring even if heading isn't perfectly reset.
  if (st.steps >= st.maxSteps) {
    st.active = false;
    // No move decided here; caller can immediately fall back to navigator on next tick.
    return null;
  }

  // Perform one wall-follow step (right- or left-hand).
  const { dir, turnDelta } = st.wallSide === 'left'
    ? wallFollowLeft(x, y, st.facing, grid)
    : wallFollowRight(x, y, st.facing, grid);

  if (dir === null) {
    // Nowhere to go (fully boxed) — give up this tick.
    return null;
  }

  const [nx, ny] = stepInDir(x, y, /** @type {Dir} */(dir));
  st.facing = /** @type {Dir} */(dir);
  st.sum += turnDelta;     // track net quarter-turns
  st.steps += 1;
  agent.heading = /** @type {Dir} */(dir);

  // If after this move the exit condition is met next tick, the orchestrator will call again and exit.
  const done = (st.sum === 0 && isClearAhead(nx, ny, st.desired, grid)) || (st.steps >= st.maxSteps);
  if (done) st.active = false;

  return { nx, ny, dir: /** @type {Dir} */(dir), done };
}

// ===== helpers =====

// Rotation maps under DIR4 = [E(0), W(1), S(2), N(3)]
const RIGHT_OF = /** @type {Dir[]} */([2, 3, 1, 0]); // E->S, W->N, S->W, N->E
const LEFT_OF  = /** @type {Dir[]} */([3, 2, 0, 1]); // E->N, W->S, S->E, N->W
const BACK_OF  = /** @type {Dir[]} */([1, 0, 3, 2]); // E->W, W->E, S->N, N->S

/**
 * Right-hand wall-follow step.
 * Preference order (standard right-hand rule):
 *   1) Try to turn right and go if clear
 *   2) Else go straight if clear
 *   3) Else turn left if clear
 *   4) Else go back if that's the only option
 *
 * Returns a chosen dir and the turnDelta (+1 right, 0 straight, -1 left, ±2 back).
 * @param {number} x
 * @param {number} y
 * @param {Dir} facing
 * @param {{isFree:(x:number,y:number)=>boolean}} grid
 * @returns {{ dir: Dir|null, turnDelta: -2|-1|0|1|2 }}
 */
function wallFollowRight(x, y, facing, grid) {
  const tryRight = RIGHT_OF[facing];
  const tryFwd   = facing;
  const tryLeft  = LEFT_OF[facing];
  const tryBack  = BACK_OF[facing];

  if (isClearAhead(x, y, tryRight, grid)) return { dir: tryRight, turnDelta: +1 };
  if (isClearAhead(x, y, tryFwd,   grid)) return { dir: tryFwd,   turnDelta:  0 };
  if (isClearAhead(x, y, tryLeft,  grid)) return { dir: tryLeft,  turnDelta: -1 };
  if (isClearAhead(x, y, tryBack,  grid)) return { dir: tryBack,  turnDelta: +2 };
  return { dir: null, turnDelta: 0 };
}

/**
 * Left-hand wall-follow step (mirror of right-hand).
 * @param {number} x
 * @param {number} y
 * @param {Dir} facing
 * @param {{isFree:(x:number,y:number)=>boolean}} grid
 */
function wallFollowLeft(x, y, facing, grid) {
  const tryLeft  = LEFT_OF[facing];
  const tryFwd   = facing;
  const tryRight = RIGHT_OF[facing];
  const tryBack  = BACK_OF[facing];

  if (isClearAhead(x, y, tryLeft,  grid)) return { dir: tryLeft,  turnDelta: -1 };
  if (isClearAhead(x, y, tryFwd,   grid)) return { dir: tryFwd,   turnDelta:  0 };
  if (isClearAhead(x, y, tryRight, grid)) return { dir: tryRight, turnDelta: +1 };
  if (isClearAhead(x, y, tryBack,  grid)) return { dir: tryBack,  turnDelta: -2 };
  return { dir: null, turnDelta: 0 };
}

/**
 * Check if stepping one tile in `dir` from (x,y) is in-bounds and free.
 * @param {number} x
 * @param {number} y
 * @param {Dir} dir
 * @param {{isFree:(x:number,y:number)=>boolean}} grid
 */
function isClearAhead(x, y, dir, grid) {
  const [nx, ny] = stepInDir(x, y, dir);
  return grid.isFree(nx, ny);
}
