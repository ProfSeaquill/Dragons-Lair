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

import { stepStraight, forwardOptions, dirFromTo, isCorridorJunction } from "../grid/topology.js";
import { edgeOpen } from "../grid/edges.js";
import { GRID, GameState } from "../state.js";
import {
  aStarToTarget,
  planSegmentToFirstJunction,
} from "./directpath.js";

import {
  createMemory, ensureMem, setSeed, pushBreadcrumb, nextUntriedExit, peekBreadcrumb, popBreadcrumb, markEdgeExplored, stepFrom } from "./memory.js";
import { isInAttackZone } from "../grid/attackzone.js"; // to test the west band tiles



const NAV = () => (globalThis.DL_NAV || {}); // console-toggle hook

//// TUNABLES ///////////////////////////////////////////////////////////////////

// Pause (in ticks) when we arrive at a junction before making a choice.
const JUNCTION_LINGER_TICKS = 0; // TUNABLE: set e.g. 3–6 for a subtle pause

// What to do if the backtrack stack becomes empty.
// - "replan": attempt another clipped A* segment toward the goal (default)
// - "halt":   stop and report STOPPED (useful for debugging)
const EMPTY_STACK_POLICY = "replan"; // TUNABLE: "replan" | "halt"

// Safety cap: prevent endless wandering if target is unreachable.
const MAX_TICKS_PER_AGENT = Number.POSITIVE_INFINITY; // TUNABLE: large enough for your maps

// Chance to ignore the best-scoring exit this decision (pick among the rest)
const EPSILON_WORSE = 0.30; // 0.0..1.0; try 0.33

// ─── Junction scoring (gentle bias toward attack band) ───────────────────────
// replace: const BIAS = Object.freeze({...})
function BIAS(agent) {
  const g = (globalThis.DL_NAV && globalThis.DL_NAV.bias) || {};
  const per = (agent && agent.nav && agent.nav.bias) || {};
  return {
    bandGain:    per.bandGain    ?? g.bandGain    ?? 1.0,
    keepHeading: per.keepHeading ?? g.keepHeading ?? 0.10,
    deltaH:      per.deltaH      ?? g.deltaH      ?? 0.00,
    eastNudge:   per.eastNudge   ?? g.eastNudge   ?? 0.00,
  };
}


function heightAt(gs, x, y) {
  const h = gs?.distFromEntry?.[y]?.[x];
  return Number.isFinite(h) ? h : -Infinity;
}

// Compute Manhattan distance to the nearest attack-zone tile (scan the band)
function manhattanToNearestBand(gs, x, y) {
  let best = Infinity;
  for (let yy = 0; yy < GRID.rows; yy++) {
    for (let xx = 0; xx < GRID.cols; xx++) {
      if (!isInAttackZone(gs, xx, yy)) continue;
      const d = Math.abs(xx - x) + Math.abs(yy - y);
      if (d < best) best = d;
    }
  }
  return best;
}


function scoreDir(agent, gs, x, y, dir, prevDir) {
  const B = BIAS(agent);

  // next tile
  let nx = x, ny = y;
  if (dir === 'E') nx = x + 1;
  else if (dir === 'W') nx = x - 1;
  else if (dir === 'S') ny = y + 1;
  else if (dir === 'N') ny = y - 1;

  const usePathHeur = agent?.nav?.pathHeur === 'astar';

  // primary: progress toward the band (gain > 0 means better)
  let gain = 0;
  if (usePathHeur) {
    const s0 = stepsToNearestBand(agent, x, y);
    const s1 = stepsToNearestBand(agent, nx, ny);
    if (Number.isFinite(s0) && Number.isFinite(s1)) gain = (s0 - s1);
  } else {
    const d0 = manhattanToNearestBand(gs, x, y);
    const d1 = manhattanToNearestBand(gs, nx, ny);
    if (Number.isFinite(d0) && Number.isFinite(d1)) gain = (d0 - d1);
  }

  let s = B.bandGain * gain;

  if (B.deltaH !== 0.0) {
    const h0 = heightAt(gs, x, y);
    const h1 = heightAt(gs, nx, ny);
    const dH = (Number.isFinite(h0) && Number.isFinite(h1)) ? (h1 - h0) : 0;
    s += B.deltaH * dH;
  }

  if (prevDir && dir === prevDir) s += B.keepHeading;

  if (B.eastNudge !== 0.0) {
    if (dir === 'E') s += B.eastNudge;
    else if (dir === 'W') s -= B.eastNudge;
  }
  return { dir, nx, ny, score: s };
}

function stepsToNearestBand(agent, x, y) {
  agent._bandStepCache = agent._bandStepCache || new Map();
  const key = (x|0) + ',' + (y|0);
  if (agent._bandStepCache.has(key)) return agent._bandStepCache.get(key);

  let best = Infinity;
  for (let yy = 0; yy < GRID.rows; yy++) {
    for (let xx = 0; xx < GRID.cols; xx++) {
      if (!isInAttackZone(GameState, xx, yy)) continue;
      const p = aStarToTarget(x, y, xx, yy);
      if (p && p.length >= 2 && p.length < best) best = p.length;
    }
  }
  const val = Number.isFinite(best) ? best : Infinity;
  agent._bandStepCache.set(key, val);
  return val;
}


function selectAttackGoal(gs, sx, sy) {
  // Scan the whole grid cheaply and collect the 3 west-band tiles
  const targets = [];
  for (let y = 0; y < GRID.rows; y++) {
    for (let x = 0; x < GRID.cols; x++) {
      if (isInAttackZone(gs, x, y)) targets.push({ x, y });
    }
  }
  if (!targets.length) return null;

  // Pick the nearest *reachable* target by A* step count
  let best = null;
  for (const t of targets) {
    const p = aStarToTarget(sx, sy, t.x, t.y);
    if (p && p.length >= 2) {
      if (!best || p.length < best.steps) best = { gx: t.x, gy: t.y, steps: p.length };
    }
  }
  if (best && globalThis.DL_NAV?.logTargets) {
    console.debug('[NAV] attack-goal chosen', best);
  }
  return best ? { gx: best.gx, gy: best.gy } : null;
}

//// Agent & FSM ////////////////////////////////////////////////////////////////

const S = Object.freeze({
  WALK_STRAIGHT: "WALK_STRAIGHT",
  FOLLOW_PLAN:   "FOLLOW_PLAN",
  DECISION:      "DECISION",
  BACKTRACK:     "BACKTRACK",
  REACHED:       "REACHED",
  STOPPED:       "STOPPED",
});

export function createAgent({ x, y, targetX, targetY, seed = 0xBEEF, nav = null } = {}) {
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
    nav: nav || undefined,
  };
  // Seed determinism explicitly (optional)
  setSeed(mem, seed >>> 0);
  agent._seenTopoVer = GameState.topologyVersion | 0;
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

function planSegment(agent) {
  // Choose dynamic goal: nearest reachable attack-zone tile, else fallback to dragon goal
  const dyn = selectAttackGoal(GameState, agent.x, agent.y);
  const G = dyn || { gx: agent.gx, gy: agent.gy };

  if (NAV().noJunctions) {
    const full = aStarToTarget(agent.x, agent.y, G.gx, G.gy);
    if (!full || full.length <= 1) { agent.plan = null; return false; }
    agent.plan = full; agent.planIdx = 1;
    agent.planFlags.clippedAtJunction = false;
    agent.planFlags.reachedGoal = true;
    agent.state = S.FOLLOW_PLAN;
    return true;
  }

  const seg = planSegmentToFirstJunction(agent.x, agent.y, G.gx, G.gy);
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

// Heuristic toward the *effective* goal: nearest attack band if available, else agent.gx/gy.
function heurToGoal(agent, x = agent.x, y = agent.y) {
  const dyn = selectAttackGoal(GameState, x, y);
  const gx = dyn ? dyn.gx : agent.gx;
  const gy = dyn ? dyn.gy : agent.gy;
  return Math.abs(x - gx) + Math.abs(y - gy);
}


export function tick(agent) {
  const tv = GameState.topologyVersion | 0;
if (agent._seenTopoVer !== tv) {
  agent._seenTopoVer = tv;
  if (agent._bandStepCache) agent._bandStepCache.clear();
}

  if (agent.state === S.REACHED || agent.state === S.STOPPED) return agent.state;
  agent.mem = ensureMem(agent.mem);
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
  // If we're sitting on a junction, force a decision even if "straight" is open.
  // (Prevents blowing past a good turn just because forward is available.)
  if (isCorridorJunction(agent.x, agent.y, agent.prevDir)) {
    agent.state = S.DECISION;
    return agent.state;
  }
  // Try to keep going straight if the edge is open.
  const straight = stepStraight(GameState, agent.x, agent.y, agent.prevDir);
  if (straight) {
    moveOne(agent, straight.x, straight.y);
    if (agent.x === agent.gx && agent.y === agent.gy) {
      agent.state = S.REACHED;
    }
    return agent.state;
  }

  // If straight was blocked, check goal and then plan a short A* segment.
  if (agent.x === agent.gx && agent.y === agent.gy) {
    agent.state = S.REACHED;
    return agent.state;
  }

  const planned = planSegment(agent);
  if (!planned) {
    // Planning failed — fall back to a local decision probe.
    agent.state = S.DECISION;
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
  if (NAV().noJunctions) {
    if (!planSegment(agent)) agent.state = S.STOPPED;
    return agent.state;
  }

  // Optional small linger
  if (agent.linger > 0) { agent.linger--; return agent.state; }

  // Junction awareness + open exits (verify edges from source)
  const atJunction = isCorridorJunction(agent.x, agent.y, agent.prevDir);
  const opts = forwardOptions(agent.x, agent.y, agent.prevDir) || [];
  const openOpts = opts.filter(o => edgeOpen(GameState, agent.x, agent.y, o.side));

  // ε only at *true forks* with 2+ choices
  const EPS = (agent.nav && typeof agent.nav.epsilonWorse === 'number')
  ? agent.nav.epsilonWorse
  : (NAV().epsilonWorse ?? 0.33);
  const epsilonActive = atJunction && openOpts.length >= 2 && Math.random() < EPS;

  // ---- Downhill block (only skipped when ε fires at a junction) ----
  if (!epsilonActive) {
    const usePathHeur = agent?.nav?.pathHeur === 'astar';
const curH = usePathHeur
  ? stepsToNearestBand(agent, agent.x, agent.y)
  : heurToGoal(agent);

let bestH = Infinity, bestSides = [];
for (const o of openOpts) {
  const h = usePathHeur
    ? stepsToNearestBand(agent, o.x, o.y)
    : heurToGoal(agent, o.x, o.y);
  if (h < bestH) { bestH = h; bestSides = [o.side]; }
  else if (h === bestH) { bestSides.push(o.side); }
}


    // Only take the downhill step if it strictly improves heuristic
    if (bestSides.length && bestH < curH) {
      const dir = bestSides[(Math.random() * bestSides.length) | 0];
      const [nx, ny] = stepFrom(agent.x, agent.y, dir);
      moveOne(agent, nx, ny);
      if (agent.x === agent.gx && agent.y === agent.gy) { agent.state = S.REACHED; return agent.state; }
      if (NAV().logChoices) console.debug('[DECISION] downhill', { at:{x:agent.x,y:agent.y}, dir, curH, bestH, atJunction });
      agent.state = S.WALK_STRAIGHT;
      return agent.state;
    }

    if (NAV().logChoices) console.debug('[DECISION] no-downhill', {
      at:{x:agent.x,y:agent.y}, curH, atJunction, opts: openOpts.map(o=>o.side)
    });
  } else {
    if (NAV().logChoices) console.debug('[DECISION ε] override-downhill at junction', {
      at:{x:agent.x,y:agent.y}, opts: openOpts.map(o=>o.side)
    });
  }
  // ---- end downhill block ----

  // Score exits (gentle band bias), highest first
  const scored = openOpts
  .map(o => scoreDir(agent, GameState, agent.x, agent.y, o.side, agent.prevDir))
  .sort((a,b) => b.score - a.score);

  // Default pick is best; ε-pick is any non-best
  let chosenDir = null;
  if (scored.length) {
    if (epsilonActive && scored.length >= 2) {
      const pool = scored.slice(1).map(s => s.dir);
      chosenDir = pool[(Math.random() * pool.length) | 0];
    } else {
      chosenDir = scored[0].dir;
    }
  }

  // Push breadcrumb so backtracking works; then (if ε) force the chosen on the crumb
  const { chosenDir: sticky } = pushBreadcrumb(
    agent.mem,
    agent.x, agent.y,
    agent.prevDir,
    scored.map(s => s.dir),
    agent.x, agent.y
  );

  // If memory chose something else but ε picked a different dir, override the crumb's chosen
  if (epsilonActive && chosenDir && sticky && sticky !== chosenDir) {
    const top = peekBreadcrumb(agent.mem);
    if (top) top.chosen = chosenDir; // surgical override of sticky randomness at this junction
  }

  const dir = chosenDir || sticky;
  if (dir) {
    const [nx, ny] = stepFrom(agent.x, agent.y, dir);
    if (edgeOpen(GameState, agent.x, agent.y, dir)) {
      moveOne(agent, nx, ny);
      if (agent.x === agent.gx && agent.y === agent.gy) { agent.state = S.REACHED; return agent.state; }
      agent.state = S.WALK_STRAIGHT;
      return agent.state;
    }
  }

  // If no exit (or blocked unexpectedly), backtrack
  agent.state = S.BACKTRACK;
  return agent.state;
}


function tickBacktrack(agent) {
  // If there’s no breadcrumb left, decide per policy.
  let top = peekBreadcrumb(agent.mem);
  if (!top) {
    if (EMPTY_STACK_POLICY === "replan") {
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
      if (edgeOpen(GameState, agent.x, agent.y, next)) {
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
