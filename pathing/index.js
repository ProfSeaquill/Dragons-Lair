// pathing/index.js
// Orchestrator for enemy movement on a static 4-way grid.
//
// Wires together:
//  - grid/api.js         (you pass an instance)
//  - pathing/directpath  (BFS distance field from EXIT)
//  - pathing/navigator   (your junction-gated Trémaux-aware navigator)
//  - pathing/detour      (tiny Pledge-style step for brief congestion)
//  - pathing/occupancy   (soft crowd signals + stable roster)
//  - pathing/separation  (sub-tile visual offsets)
//
// Public API:
//   initPathing(grid, exit, opts?) -> ctx { dp, occ, grid, opts }
//   spawnAgent(agent, ctx)
//   despawnAgent(agent, ctx)
//   updateAgent(agent, dtSec, ctx) -> { moved:boolean, nx:number, ny:number } | null
//   renderOffset(agent, ctx) -> [ox, oy]
//
// Notes:
// - Detour is only for *congestion*. Walls/mazes are handled by directpath+navigator.
// - Timing is optional: if you pass dtSec each tick and set a speed, we'll step
//   only when the per-tile travel time elapses. If you ignore timing, we step every call.

import { buildDirectPath, getBestDirs, stepInDir } from './directpath.js';
import { chooseNextStep as chooseNavStep } from './navigator.js';
import { startDetour, detourStep, DEFAULT_DETOUR_OPTS } from './detour.js';
import { makeOccupancy } from './occupancy.js';
import { renderOffset as computeSepOffset, DEFAULT_SEP_OPTS } from './separation.js';

/** @typedef {0|1|2|3} Dir */

export const DEFAULT_INDEX_OPTS = {
  // --- Detour / crowd handling ---
  enableDetourOnCrowd: true,
  softCap: 3,                // >= this on a tile counts as "crowded"
  detour: { ...DEFAULT_DETOUR_OPTS, maxSteps: 2 }, // brief slip-around

  // --- Movement timing (optional) ---
  useTiming: false,          // if true, respect per-agent speed (tiles/sec)
  defaultSpeed: 2.0,         // tiles per second if agent.speedTilesPerSec is missing

  // --- Separation (visual only) ---
  separation: { ...DEFAULT_SEP_OPTS },

  // --- Safety ---
  clampMovesToFree: true,    // refuse a move if target suddenly not free
};

/**
 * Initialize pathing for a run.
 * @param {{cols:number, rows:number, isFree:(x:number,y:number)=>boolean, neighbors4:(x:number,y:number)=>Array<[number,number]>, inBounds:(x:number,y:number)=>boolean}} grid
 * @param {{x:number, y:number}} exit
 * @param {Partial<typeof DEFAULT_INDEX_OPTS>} [optsIn]
 */
export function initPathing(grid, exit, optsIn) {
  const opts = deepMerge(DEFAULT_INDEX_OPTS, optsIn || {});
  const dp = buildDirectPath(exit.x | 0, exit.y | 0, grid);
  const occ = makeOccupancy(grid.cols, grid.rows);
  return { dp, occ, grid, opts, exit };
}

/** Register an agent into occupancy (call once when it spawns). */
export function spawnAgent(agent, ctx) {
  // Expected agent shape: { id, x, y, heading?:Dir, speedTilesPerSec? }
  if (agent == null) return;
  agent._marks ??= new Map();
  agent._uphillRun ??= 0;
  agent._moveClock ??= 0; // seconds accumulator for timing mode
  ctx.occ.enter(agent.id, agent.x | 0, agent.y | 0);
}

/** Unregister an agent (call on death/despawn). */
export function despawnAgent(agent, ctx) {
  if (agent == null) return;
  ctx.occ.leave(agent.id, agent.x | 0, agent.y | 0);
}

/**
 * Per-tick update. If timing is enabled, advances only when a full-tile move fits.
 * Otherwise, performs one grid step immediately.
 *
 * @param {{id:any, x:number, y:number, heading?:Dir, speedTilesPerSec?:number, _detour?:any, _moveClock?:number}} agent
 * @param {number} dtSec   // delta time in seconds (can be 0 if not using timing)
 * @param {{ dp:any, occ:any, grid:any, opts:typeof DEFAULT_INDEX_OPTS }} ctx
 * @returns {{ moved:boolean, nx:number, ny:number } | null}
 */
export function updateAgent(agent, dtSec, ctx) {
  const { dp, occ, grid, opts } = ctx;

  // Optional timing: accumulate time until one full tile move is ready.
  if (opts.useTiming) {
    const v = (agent.speedTilesPerSec ?? opts.defaultSpeed);
    const stepTime = v > 0 ? (1 / v) : Infinity;
    agent._moveClock = (agent._moveClock || 0) + (dtSec || 0);
    if (agent._moveClock + 1e-9 < stepTime) return null; // not yet time to move
    agent._moveClock -= stepTime; // consume exact one-tile time slice
  }

  const x = agent.x | 0, y = agent.y | 0;

  // 1) If currently detouring for crowd, try a detour step first.
  if (agent._detour?.active) {
    const step = detourStep(agent, grid, occ);
    if (step && step.nx != null) {
      if (!opts.clampMovesToFree || grid.isFree(step.nx, step.ny)) {
        moveTo(agent, step.nx, step.ny, ctx);
        return { moved: true, nx: step.nx, ny: step.ny };
      }
      // If clamp blocks it, fall through to navigator.
    }
    // If detourStep returned null (gave up), proceed to normal navigation.
  }

  // 2) Consider detour trigger for *crowding* only (not for walls).
  if (opts.enableDetourOnCrowd) {
    const downhill = getBestDirs(dp, x, y);
    if (downhill.length > 0) {
      // If every downhill neighbor is over softCap, trigger a brief detour.
      const allDownhillCrowded = downhill.every((dir) => {
        const [nx, ny] = stepInDir(x, y, dir);
        return occ.isSoftBlocked(occ, nx, ny, opts.softCap);
      });
      if (allDownhillCrowded) {
        // Choose a desired direction: keep current heading if it's one of the downhill dirs,
        // otherwise just pick the first downhill dir (they're all blocked anyway).
        /** @type {Dir} */
        let desired = downhill[0];
        if (agent.heading != null && downhill.includes(/** @type {Dir} */(agent.heading))) {
          desired = /** @type {Dir} */(agent.heading);
        }
        startDetour(agent, desired, opts.detour);
        const step = detourStep(agent, grid, occ);
        if (step && step.nx != null) {
          if (!opts.clampMovesToFree || grid.isFree(step.nx, step.ny)) {
            moveTo(agent, step.nx, step.ny, ctx);
            return { moved: true, nx: step.nx, ny: step.ny };
          }
        }
        // If detour couldn't move, fall through to normal nav this tick.
      }
    }
  }

  // 3) Normal navigation (your junction-gated Trémaux logic lives inside).
  const nav = chooseNavStep(agent, dp, grid, occ, {
    softCap: opts.softCap,
  });
  if (!nav) return null;

  if (opts.clampMovesToFree && !grid.isFree(nav.nx, nav.ny)) {
    // Defensive: target somehow invalid; skip this tick.
    
    if (!nav) {
  console.debug('[path] stuck at', agent.x, agent.y,
    'downs=', getBestDirs(dp, agent.x|0, agent.y|0),
    'ns=', ctx.grid.neighbors4(agent.x|0, agent.y|0));
  return null;
}

  moveTo(agent, nav.nx, nav.ny, ctx);
  return { moved: true, nx: nav.nx, ny: nav.ny };
}

/** Visual-only sub-tile offset for rendering. */
export function renderOffset(agent, ctx, tileSize) {
  return computeSepOffset(agent, ctx.occ, tileSize, ctx.opts.separation);
}

// ===== internal helpers =====

function moveTo(agent, nx, ny, ctx) {
  const { occ } = ctx;
  const ox = agent.x | 0, oy = agent.y | 0;
  if (ox === (nx | 0) && oy === (ny | 0)) return;

  // Update occupancy first to keep rosters in sync
  occ.leave(agent.id, ox, oy);
  agent.x = nx | 0;
  agent.y = ny | 0;
  occ.enter(agent.id, agent.x, agent.y);
}

/** Simple deep merge for opts */
function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k in patch) {
    const bv = base?.[k];
    const pv = patch[k];
    out[k] =
      (pv && typeof pv === 'object' && !Array.isArray(pv))
        ? deepMerge(bv ?? {}, pv)
        : pv;
  }
  return out;
}
