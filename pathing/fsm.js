// pathing/fsm.js
// Tiny FSM for: Walk straight → plan A* segment when blocked → random-at-junction with memory.
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - Step speed:          1 tile per tick (simple). If your game does substeps,
//                        call tick() multiple times per frame or adapt moveOne().
// - Junction linger:     Optionally pause a few ticks at junctions (off by default).
// - A* segment strategy: We A* to the goal, then CLIP at the FIRST JUNCTION
//                        (so later junctions remain random). See planSegmentToFirstJunction().
// - Backtrack strategy:  When no exits remain, A* back to the LAST breadcrumb junction,
//                        pop it, try the next exit. If stack empties, we re-run a segment
//                        to the goal or stop (see TUNABLEs below).
// - Edge marking:        We mark every step A->B as "explored" so a junction won't
//                        pick the same edge again after backtracking.
// ──────────────────────────────────────────────────────────────────────────────

import { stepStraight, forwardOptions, dirFromTo, isJunction, } from "../grid/topology.js";
import { isOpen as isPassable } from '../state.js';
import {
  aStarToTarget,
  planSegmentToFirstJunction,
} from "./directpath.js";

import {
  createMemory,
  setSeed,
  pushBreadcrumb,
  nextUntriedExit,
  peekBreadcrumb,
  popBreadcrumb,
  markEdgeExplored,
  stepFrom,
} from "./memory.js";

//// TUNABLES ///////////////////////////////////////////////////////////////////

// Pause (in ticks) when we arrive at a junction before making a choice.
const JUNCTION_LINGER_TICKS = 0; // TUNABLE: set e.g. 3–6 for a subtle pause

// What to do if the backtrack stack becomes empty.
// - "replan": attempt another clipped A* segment toward the goal (default)
// - "halt":   stop and report STOPPED (useful for debugging)
const EMPTY_STACK_POLICY = "replan"; // TUNABLE: "replan" | "halt"

// Safety cap: prevent endless wandering if target is unreachable.
const MAX_TICKS_PER_AGENT = 50_000; // TUNABLE: large enough for your maps

//// Agent & FSM ////////////////////////////////////////////////////////////////

const S = Object.freeze({
  WALK_STRAIGHT: "WALK_STRAIGHT",
  FOLLOW_PLAN:   "FOLLOW_PLAN",
  DECISION:      "DECISION",
  BACKTRACK:     "BACKTRACK",
  REACHED:       "REACHED",
  STOPPED:       "STOPPED",
});

export function createAgent({ x, y, targetX, targetY, seed = 0xBEEF } = {}) {
  const mem = createMemory(seed);
  const agent = {
    // position + heading
    x: x|0, y: y|0,
    prevDir: "E", // we spawn walking east by rule #1

    // goal
    gx: targetX|0, gy: targetY|0,

    // fsm
    state: S.WALK_STRAIGHT,
    linger: 0,

    // plan buffer for FOLLOW_PLAN (array of {x,y}), and index of next step
    plan: null,
    planIdx: 0,
    planFlags: { clippedAtJunction: false, reachedGoal: false },

    // memory
    mem,

    // bookkeeping
    tickCount: 0,
  };
  // Seed determinism explicitly (optional)
  setSeed(mem, seed >>> 0);
  return agent;
}

/** Move a single tile to (nx,ny), updating direction & memory edge marks. */
function moveOne(agent, nx, ny) {
  const dir = dirFromTo(agent.x, agent.y, nx, ny);
  // Mark the edge we actually traversed as explored
  markEdgeExplored(agent.mem, agent.x, agent.y, nx, ny);
  agent.prevDir = dir || agent.prevDir;
  agent.x = nx; agent.y = ny;
}

/** Queue a new A* segment that ends at the first junction (or goal). */
function planSegment(agent) {
  const seg = planSegmentToFirstJunction(agent.x, agent.y, agent.gx, agent.gy);
  if (!seg || !seg.path || seg.path.length <= 1) {
    agent.plan = null;
    return false;
  }
  agent.plan = seg.path;           // includes current tile as first element
  agent.planIdx = 1;               // next step index
  agent.planFlags.clippedAtJunction = seg.clippedAtJunction;
  agent.planFlags.reachedGoal = seg.reachedGoal;
  agent.state = S.FOLLOW_PLAN;
  return true;
}

/** A* all the way to a specific tile (used for backtracking to a junction). */
function planTo(agent, tx, ty) {
  const full = aStarToTarget(agent.x, agent.y, tx, ty);
  if (!full || full.length <= 1) return false;
  agent.plan = full;
  agent.planIdx = 1;
  agent.planFlags.clippedAtJunction = false;
  agent.planFlags.reachedGoal = (tx === agent.gx && ty === agent.gy);
  agent.state = S.FOLLOW_PLAN;
  return true;
}

export function setTarget(agent, gx, gy) { agent.gx = gx|0; agent.gy = gy|0; }

export function getState(agent) { return agent.state; }

export function tick(agent) {
  if (agent.state === S.REACHED || agent.state === S.STOPPED) return agent.state;

  agent.tickCount++;
  if (agent.tickCount > MAX_TICKS_PER_AGENT) {
    agent.state = S.STOPPED;
    return agent.state;
    }

  switch (agent.state) {
    case S.WALK_STRAIGHT: return tickWalkStraight(agent);
    case S.FOLLOW_PLAN:   return tickFollowPlan(agent);
    case S.DECISION:      return tickDecision(agent);
    case S.BACKTRACK:     return tickBacktrack(agent);
  }
  return agent.state;
}

//// State handlers /////////////////////////////////////////////////////////////

function tickWalkStraight(agent) {
  // Rule #1: walk east by default, but "straight" maintains current prevDir.
  // Try to continue straight if passable and NOT a junction ahead.
  const straight = stepStraight(agent.x, agent.y, agent.prevDir);
  if (straight && !isJunction(straight.x, straight.y, agent.prevDir)) {
    moveOne(agent, straight.x, straight.y);
    // Check goal
    if (agent.x === agent.gx && agent.y === agent.gy) {
      agent.state = S.REACHED; return agent.state;
    }
    return agent.state;
  }

  // If next straight step is blocked or next tile is a junction, plan a segment.
  if (agent.x === agent.gx && agent.y === agent.gy) {
    agent.state = S.REACHED; return agent.state;
  }
  const planned = planSegment(agent);
  if (!planned) {
    // If planning failed (rare), escalate to DECISION if we are at a junction,
    // else mark STOPPED (or you could attempt small probes).
    if (isJunction(agent.x, agent.y, agent.prevDir)) {
      agent.state = S.DECISION;
    } else {
      agent.state = S.STOPPED;
    }
  }
  return agent.state;
}

function tickFollowPlan(agent) {
  // Follow the planned sequence 1 tile per tick
  if (!agent.plan || agent.planIdx >= agent.plan.length) {
    // If we ran out of steps unexpectedly, go to DECISION at current tile
    agent.state = S.DECISION;
    return agent.state;
  }

  const step = agent.plan[agent.planIdx++];
  moveOne(agent, step.x, step.y);

  // Reached whole goal?
  if (agent.x === agent.gx && agent.y === agent.gy) {
    agent.state = S.REACHED; return agent.state;
  }

  // If we clipped at junction and we've arrived there, switch to DECISION with optional linger
  if (agent.planIdx >= agent.plan.length && agent.planFlags.clippedAtJunction) {
    agent.linger = JUNCTION_LINGER_TICKS;
    agent.state = S.DECISION;
    return agent.state;
  }

  // If the plan naturally ended (no junction encountered), resume WALK_STRAIGHT
  if (agent.planIdx >= agent.plan.length) {
    agent.state = S.WALK_STRAIGHT;
  }
  return agent.state;
}

function tickDecision(agent) {
  // Optional small linger
  if (agent.linger > 0) { agent.linger--; return agent.state; }

  // Gather exits excluding back edge; memory will also exclude edges already explored.
  const exits = forwardOptions(agent.x, agent.y, agent.prevDir).map(n => n.dir);
  const { chosenDir } = pushBreadcrumb(
    agent.mem,
    agent.x, agent.y,
    agent.prevDir,
    exits,
    agent.x, agent.y
  );

  if (chosenDir) {
    // Take that exit exactly one tile, then resume WALK_STRAIGHT
    const [nx, ny] = stepFrom(agent.x, agent.y, chosenDir);
    if (isPassable(nx, ny)) {
      moveOne(agent, nx, ny);
      if (agent.x === agent.gx && agent.y === agent.gy) {
        agent.state = S.REACHED; return agent.state;
      }
      agent.state = S.WALK_STRAIGHT;
      return agent.state;
    }
    // If somehow now blocked, fall back to BACKTRACK
  }

  // No exits remain (or chosen exit was blocked unexpectedly) → BACKTRACK
  agent.state = S.BACKTRACK;
  return agent.state;
}

function tickBacktrack(agent) {
  // If there’s no breadcrumb left, decide per policy.
  let top = peekBreadcrumb(agent);
  if (!top) {
    if (EMPTY_STACK_POLICY === "replan") {
      // Try one more segment toward goal
      const ok = planSegment(agent);
      if (!ok) {
        agent.state = S.STOPPED;
      }
      return agent.state;
    } else {
      agent.state = S.STOPPED;
      return agent.state;
    }
  }

  // If we are already at the junction, try the next untried exit
  if (agent.x === top.jx && agent.y === top.jy) {
    const next = nextUntriedExit(agent.mem);
    if (next) {
      const [nx, ny] = stepFrom(agent.x, agent.y, next);
      if (isPassable(nx, ny)) {
        moveOne(agent, nx, ny);
        if (agent.x === agent.gx && agent.y === agent.gy) {
          agent.state = S.REACHED; return agent.state;
        }
        agent.state = S.WALK_STRAIGHT;
        return agent.state;
      }
      // If blocked unexpectedly, try another remaining; if none, pop and recurse next tick
      return agent.state; // stay in BACKTRACK; next tick will call nextUntriedExit again
    } else {
      // Exhausted this junction completely
      popBreadcrumb(agent.mem);
      return agent.state; // stay BACKTRACK; next tick will target previous junction
    }
  }

  // Plan back to the top breadcrumb junction
  if (!agent.plan || agent.planIdx >= agent.plan.length) {
    const ok = planTo(agent, top.jx, top.jy);
    if (!ok) {
      // If we can’t path back (should be rare unless map changed), pop and try previous
      popBreadcrumb(agent.mem);
    }
    return agent.state;
  }

  // Follow the backtrack plan 1 step
  const step = agent.plan[agent.planIdx++];
  moveOne(agent, step.x, step.y);
  // When we arrive, next tick will attempt nextUntriedExit
  return agent.state;
}

//// Convenience: run agent until completion (debug/dev) ////////////////////////

/** Step the agent until REACHED or STOPPED, with a hard cap to avoid hangs. */
export function runToEnd(agent, maxSteps = 10_000) {
  let steps = 0;
  while (steps++ < maxSteps) {
    const st = tick(agent);
    if (st === S.REACHED || st === S.STOPPED) return st;
  }
  return agent.state;
}
