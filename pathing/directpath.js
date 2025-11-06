// pathing/directpath.js
// Grid-optimized A* + "clip at first junction" helper (engine-agnostic)
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - Heuristic:         manhattan() by default (best for 4-connected grids).
//                      You can scale it with HEURISTIC_WEIGHT for greediness.
// - Costs:             Every step costs 1 on a flat grid; add terrain costs
//                      in costOf() if you later need slow tiles, etc.
// - Search caps:       MAX_NODES and MAX_MICROS guard worst-case mazes on mobile.
// - Tie-breakers:      When f-scores tie, we prefer lower h (closer to goal);
//                      you can also prefer straight/“east” in tieBreak().
// - Clip behavior:     clipAtFirstJunction() stops ON the first junction tile
//                      after leaving start, so your FSM can run a Decision there.
// ──────────────────────────────────────────────────────────────────────────────

import { neighbors4, dirFromTo, isJunction, } from "../grid/topology.js";
import { GRID, isOpen as isPassable, inBounds } from '../state.js';




//// TUNABLES ///////////////////////////////////////////////////////////////////

// Heuristic scale: >1.0 makes A* greedier (fewer expansions, riskier suboptimal).
const HEURISTIC_WEIGHT = 1.0; // TUNABLE: 0.9..1.5 is a sensible range

// Safety caps for mobile; keep small to avoid frame spikes.
const MAX_NODES  = 5000;    // TUNABLE: upper bound on opened nodes
const MAX_MICROS = 2_000;   // TUNABLE: ~2ms budget per call in microseconds

// Optional: prefer continuing straight (small bonus) when breaking ties.
const STRAIGHT_TIE_BONUS = 0.05; // TUNABLE: 0 (off) .. 0.1 (subtle)

// Optional: prefer generally eastward progress (tiny theme bonus).
const EASTWARD_TIE_BONUS = 0.00; // TUNABLE: 0 to disable

//// Heuristic & cost helpers ///////////////////////////////////////////////////

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// TUNABLE: If you add terrain, encode costs here (must be >=1).
function costOf(/*x,y*/) { return 1; }

function heuristic(ax, ay, bx, by) {
  return HEURISTIC_WEIGHT * manhattan(ax, ay, bx, by);
}

// Tie-breaker to keep expansions stable and “natural”.
function tieBreak(a, b, goalX, goalY, cameFromDir) {
  // Prefer lower heuristic
  const ha = manhattan(a.x, a.y, goalX, goalY);
  const hb = manhattan(b.x, b.y, goalX, goalY);
  if (ha !== hb) return ha - hb;

  // Slightly prefer continuing straight
  if (cameFromDir) {
    const da = dirFromTo(a.px, a.py, a.x, a.y);
    const db = dirFromTo(b.px, b.py, b.x, b.y);
    const aStraight = (da === cameFromDir) ? -STRAIGHT_TIE_BONUS : 0;
    const bStraight = (db === cameFromDir) ? -STRAIGHT_TIE_BONUS : 0;
    if (aStraight !== bStraight) return aStraight - bStraight;
  }

  // Optional: nudge eastward
  if (EASTWARD_TIE_BONUS > 0) {
    const aBias = -EASTWARD_TIE_BONUS * a.x;
    const bBias = -EASTWARD_TIE_BONUS * b.x;
    if (aBias !== bBias) return aBias - bBias;
  }

  // Stable fallback
  return 0;
}

//// Lightweight priority queue (binary heap) //////////////////////////////////

class MinHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(node) {
    const a = this.a; a.push(node); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; if (!a.length) return null;
    const top = a[0], last = a.pop();
    if (a.length) { a[0] = last; this._down(0); }
    return top;
  }
  _down(i) {
    const a = this.a; const n = a.length;
    while (true) {
      let l = i * 2 + 1, r = l + 1, m = i;
      if (l < n && a[l].f < a[m].f) m = l;
      if (r < n && a[r].f < a[m].f) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i], a[m]]; i = m;
    }
  }
}

//// Core A* ////////////////////////////////////////////////////////////////////

/**
 * Grid A* from (sx,sy) to (gx,gy). Returns an array of {x,y} including start & goal.
 * Caps work by MAX_NODES and MAX_MICROS; returns null on failure or timeout.
 * TUNABLE: If you want partial paths on timeout, you can return the best-so-far.
 */
export function aStarToTarget(sx, sy, gx, gy) {
  if (!inBounds(sx, sy) || !inBounds(gx, gy) || !isPassable(sx, sy) || !isPassable(gx, gy)) {
    return null;
  }
  if (sx === gx && sy === gy) return [{ x: sx, y: sy }];

  const open = new MinHeap();
  const gScore = new Map();       // "x,y" -> g
  const cameFrom = new Map();     // "x,y" -> "px,py"
  const startKey = key(sx, sy);

  // Seed node
  const h0 = heuristic(sx, sy, gx, gy);
  open.push({ x: sx, y: sy, f: h0, g: 0, px: sx, py: sy });
  gScore.set(startKey, 0);

  const t0 = performance.now();
  let nodes = 0;

  while (open.size()) {
    // Guard: time and node caps
    nodes++;
    if (nodes > MAX_NODES) return null;
    if ((performance.now() - t0) * 1000 > MAX_MICROS) return null;

    // Pop best
    const cur = open.pop();
    const { x, y, g } = cur;
    if (x === gx && y === gy) {
      return reconstructPath(cameFrom, x, y, sx, sy);
    }

    // Expand neighbors (N,E,S,W deterministic)
    const nbrs = neighbors4(x, y);
    // Optional: stable tie-breaking by sorting equal f; keep cheap for now.

    for (const n of nbrs) {
      const nk = key(n.x, n.y);
      const tentativeG = g + costOf(n.x, n.y);
      const prevBest = gScore.get(nk);
      if (prevBest !== undefined && tentativeG >= prevBest) continue;

      // Record path
      gScore.set(nk, tentativeG);
      cameFrom.set(nk, key(x, y));

      // Score node
      const h = heuristic(n.x, n.y, gx, gy);
      let f = tentativeG + h;

      // Tie-break tweak (optional, tiny)
      const cmp = tieBreak(
        { x: n.x, y: n.y, px: x, py: y, f },
        { x, y, px: x, py: y, f: cur.f ?? f },
        gx, gy,
        dirFromTo(cur.px, cur.py, x, y)
      );
      // Lower is better; if n “wins”, give it a tiny nudge
      if (cmp < 0) f -= 1e-6;

      open.push({ x: n.x, y: n.y, f, g: tentativeG, px: x, py: y });
    }
  }

  return null;
}

function key(x, y) { return `${x},${y}`; }

function reconstructPath(cameFrom, x, y, sx, sy) {
  const out = [{ x, y }];
  let k = cameFrom.get(key(x, y));
  while (k) {
    const [px, py] = k.split(",").map(v => parseInt(v, 10));
    out.push({ x: px, y: py });
    if (px === sx && py === sy) break;
    k = cameFrom.get(k);
  }
  return out.reverse();
}

//// Clip-at-first-junction helper /////////////////////////////////////////////

/**
 * Clip a full path so you only follow it *until the first junction*.
 * We consider the first step’s direction as prevDir; we stop on the first
 * node that qualifies as a junction with respect to that prevDir.
 *
 * Returns:
 *   { subpath, reachedGoal, clippedAtJunction }
 * where subpath includes start and the last included node.
 */
export function clipAtFirstJunction(fullPath) {
  if (!fullPath || fullPath.length <= 1) {
    return { subpath: fullPath ?? null, reachedGoal: !!fullPath && fullPath.length === 1, clippedAtJunction: false };
  }
  const sub = [fullPath[0]];
  let prev = fullPath[0];
  let prevDir = null;

  for (let i = 1; i < fullPath.length; i++) {
    const cur = fullPath[i];
    const dir = dirFromTo(prev.x, prev.y, cur.x, cur.y);
    // Record step
    sub.push(cur);

    // Establish prevDir once we have a first move
    if (!prevDir) prevDir = dir;

    // If the *current* node is a junction w.r.t. prevDir, we stop here.
    if (isJunction(cur.x, cur.y, prevDir)) {
      return { subpath: sub, reachedGoal: false, clippedAtJunction: true };
    }

    prev = cur;
    prevDir = dir;
  }
  // No junction encountered; we either reached the goal or corridor end.
  return { subpath: sub, reachedGoal: true, clippedAtJunction: false };
}

//// High-level utility you’ll call from the FSM ////////////////////////////////

/**
 * Plan an optimal segment from (sx,sy) to (gx,gy), but only follow it up to
 * the first junction; after that, your FSM should enter a Decision state.
 *
 * Returns:
 *   null on failure, or
 *   { path: [{x,y}...], reachedGoal, clippedAtJunction }
 *
 * TUNABLE: If you want “partial on fail”, you could return the longest
 * reached path toward the goal when aStarToTarget() returns null.
 */
export function planSegmentToFirstJunction(sx, sy, gx, gy) {
  const full = aStarToTarget(sx, sy, gx, gy);
  if (!full) return null;
  const { subpath, reachedGoal, clippedAtJunction } = clipAtFirstJunction(full);
  return { path: subpath, reachedGoal, clippedAtJunction };
}
