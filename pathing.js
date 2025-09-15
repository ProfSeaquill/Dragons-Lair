// pathing.js — edge-walls pathing with live shortest-path-to-exit steering

import * as state from './state.js';

/* =========================
 * Distance Fields (BFS)
 * ========================= */

/** Recompute gs.distFromEntry[y][x]: shortest steps from ENTRY through open edges. */
export function recomputeDistanceField(gs = state.GameState) {
  gs.distFromEntry = bfsField(gs, state.ENTRY.x, state.ENTRY.y);
  return gs.distFromEntry;
}

/** New: Recompute gs.distToExit[y][x]: shortest steps TO EXIT (BFS from EXIT). */
export function recomputeExitField(gs = state.GameState) {
  gs.distToExit = bfsField(gs, state.EXIT.x, state.EXIT.y);
  return gs.distToExit;
}

/** Shared BFS helper (walls respected). Infinity = unreachable. */
function bfsField(gs, sx, sy) {
  const W = state.GRID.cols, H = state.GRID.rows;
  const dist = state.makeScalarField(W, H, Infinity);
  if (!state.inBounds(sx, sy)) return dist;

  const qx = new Array(W * H), qy = new Array(W * H);
  let qh = 0, qt = 0;

  dist[sy][sx] = 0;
  qx[qt] = sx; qy[qt] = sy; qt++;

  while (qh < qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    const d = dist[y][x] + 1;

    if (state.isOpen(gs, x, y, 'N')) push(x, y - 1);
    if (state.isOpen(gs, x, y, 'E')) push(x + 1, y);
    if (state.isOpen(gs, x, y, 'S')) push(x, y + 1);
    if (state.isOpen(gs, x, y, 'W')) push(x - 1, y);

    function push(nx, ny) {
      if (!state.inBounds(nx, ny)) return;
      if (d < dist[ny][nx]) {
        dist[ny][nx] = d;
        qx[qt] = nx; qy[qt] = ny; qt++;
      }
    }
  }
  return dist;
}

/* =========================
 * Connectivity Guard
 * ========================= */

/**
 * Quick BFS reachability check used by the UI guard: would toggling (x,y,side)
 * disconnect ENTRY↔EXIT? We “apply” the wall in-memory, test, then restore.
 */
export function wouldDisconnectEntryAndExit(gs, x, y, side, placeWall) {
  const snap = snapshotEdgePair(gs, x, y, side);
  if (!applyEdgeSim(gs, x, y, side, !!placeWall)) return true;

  const ok = isReachable(gs, state.ENTRY.x, state.ENTRY.y, state.EXIT.x, state.EXIT.y);

  restoreEdgePair(gs, x, y, side, snap);
  return !ok;
}

function isReachable(gs, sx, sy, tx, ty) {
  if (!state.inBounds(sx, sy) || !state.inBounds(tx, ty)) return false;
  const W = state.GRID.cols, H = state.GRID.rows;
  const seen = new Uint8Array(W * H);
  const qx = new Array(W * H), qy = new Array(W * H);
  let qh = 0, qt = 0;

  seen[sy * W + sx] = 1; qx[qt] = sx; qy[qt] = sy; qt++;

  while (qh < qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    if (x === tx && y === ty) return true;
    if (state.isOpen(gs, x, y, 'N')) push(x, y - 1);
    if (state.isOpen(gs, x, y, 'E')) push(x + 1, y);
    if (state.isOpen(gs, x, y, 'S')) push(x, y + 1);
    if (state.isOpen(gs, x, y, 'W')) push(x - 1, y);
  }
  return false;

  function push(nx, ny) {
    if (!state.inBounds(nx, ny)) return;
    const i = ny * W + nx;
    if (seen[i]) return;
    seen[i] = 1;
    qx[qt] = nx; qy[qt] = ny; qt++;
  }
}

function snapshotEdgePair(gs, x, y, side) {
  const here = state.ensureCell(gs, x, y);
  const { nx, ny, opp } = neighborFor(x, y, side);
  if (!state.inBounds(nx, ny)) return null;
  const there = state.ensureCell(gs, nx, ny);
  return { side, opp, x, y, nx, ny, a: here[side], b: there[opp] };
}
function restoreEdgePair(gs, x, y, side, snap) {
  if (!snap) return;
  const here = state.ensureCell(gs, x, y);
  const there = state.ensureCell(gs, snap.nx, snap.ny);
  here[side] = snap.a;
  there[snap.opp] = snap.b;
}
function applyEdgeSim(gs, x, y, side, hasWall) {
  const { nx, ny, opp } = neighborFor(x, y, side);
  if (!state.inBounds(nx, ny)) return false;
  const here = state.ensureCell(gs, x, y);
  const there = state.ensureCell(gs, nx, ny);
  here[side] = !!hasWall;
  there[opp] = !!hasWall;
  return true;
}
function neighborFor(x, y, side) {
  switch (side) {
    case 'N': return { nx: x, ny: y - 1, opp: 'S' };
    case 'S': return { nx: x, ny: y + 1, opp: 'N' };
    case 'E': return { nx: x + 1, ny: y, opp: 'W' };
    case 'W': return { nx: x - 1, ny: y, opp: 'E' };
    default:  return { nx: x, ny: y, opp: side };
  }
}

/* =========================
 * Edge Toggling (UI hook)
 * ========================= */

export function toggleEdge(gs, x, y, side, place = true) {
  if (!state.inBounds(x, y)) return { ok: false, reason: 'Out of bounds' };
  if (place && !state.canAffordEdge(gs, true)) {
    return { ok: false, reason: 'Not enough bones' };
  }
  if (wouldDisconnectEntryAndExit(gs, x, y, side, place)) {
    return { ok: false, reason: 'Would fully block the cave' };
  }

  const applied = state.setEdgeWall(gs, x, y, side, !!place);
  if (!applied) return { ok: false, reason: 'Invalid neighbor' };

  // Spend / refund
  if (place) state.spendBones(gs, state.COSTS.edgeWall);
  else state.refundBones(gs, state.COSTS.edgeRefund);

  // Update BOTH fields so steering adapts immediately
  recomputeDistanceField(gs);
  recomputeExitField(gs);

  return { ok: true };
}

/* =========================
 * Greedy-to-Exit Enemy API
 * ========================= */

/** Keep per-tick cache of distance-from-entry (used by combat’s shield rules). */
export function updateEnemyDistance(gs, e) {
  if (state.inBounds(e.cx, e.cy)) {
    e.distFromEntry = gs.distFromEntry?.[e.cy]?.[e.cx] ?? Infinity;
  } else {
    e.distFromEntry = Infinity;
  }
}

/** Choose direction that strictly DECREASES distToExit; ties break by Manhattan to EXIT. */
export function chooseNextDirectionToExit(gs, e) {
  const D = gs.distToExit;
  if (!D) return e.dir || 'E';

  const x = e.cx | 0, y = e.cy | 0;
  const here = D?.[y]?.[x];
  if (!isFinite(here)) {
    // If we’re off-field, pick any open edge toward EXIT heuristically
    return heuristicFallback(gs, e);
  }

  let bestDir = null, bestVal = here, bestHeu = Infinity;

  const candidates = [
    ['N', x, y - 1],
    ['E', x + 1, y],
    ['S', x, y + 1],
    ['W', x - 1, y],
  ];

  for (const [dir, nx, ny] of candidates) {
    if (!state.isOpen(gs, x, y, dir)) continue;
    const v = D?.[ny]?.[nx];
    if (!isFinite(v)) continue;
    if (v < bestVal) {
      bestDir = dir;
      bestVal = v;
      bestHeu = manhattan(nx, ny, state.EXIT.x, state.EXIT.y);
    } else if (v === bestVal) {
      // Tie-breaker: closer to EXIT in Manhattan metric
      const h = manhattan(nx, ny, state.EXIT.x, state.EXIT.y);
      if (h < bestHeu) {
        bestDir = dir;
        bestHeu = h;
      }
    }
  }

  return bestDir ?? heuristicFallback(gs, e);
}

function heuristicFallback(gs, e) {
  // If no improving neighbor (local basin due to dynamic edits), pick any open edge
  const ns = state.neighborsByEdges(gs, e.cx, e.cy);
  if (ns.length) {
    // Prefer one that reduces straight-line distance to EXIT
    let best = ns[0], bestHeu = Infinity;
    for (const n of ns) {
      const h = manhattan(n.x, n.y, state.EXIT.x, state.EXIT.y);
      if (h < bestHeu) { bestHeu = h; best = n; }
    }
    return directionFromTo(e.cx, e.cy, best.x, best.y) || (e.dir || 'E');
  }
  return e.dir || 'E';
}

function manhattan(x0, y0, x1, y1) { return Math.abs(x1 - x0) + Math.abs(y1 - y0); }

function directionFromTo(x0, y0, x1, y1) {
  if (x1 === x0 && y1 === y0 - 1) return 'N';
  if (x1 === x0 + 1 && y1 === y0) return 'E';
  if (x1 === x0 && y1 === y0 + 1) return 'S';
  if (x1 === x0 - 1 && y1 === y0) return 'W';
  return null;
}

function stepFrom(x, y, dir) {
  switch (dir) {
    case 'N': return { nx: x, ny: y - 1 };
    case 'S': return { nx: x, ny: y + 1 };
    case 'E': return { nx: x + 1, ny: y };
    case 'W': return { nx: x - 1, ny: y };
    default:  return { nx: x, ny: y };
  }
}

/**
 * Instant hop by one cell using greedy-to-exit direction.
 */
export function advanceEnemyOneCell(gs, e) {
  const dir = chooseNextDirectionToExit(gs, e);
  const { nx, ny } = stepFrom(e.cx, e.cy, dir);
  if (!state.inBounds(nx, ny)) return;
  e.cx = nx; e.cy = ny; e.dir = dir;
  updateEnemyDistance(gs, e);
}

/**
 * Pixel-smooth movement between tile centers, re-evaluating target each arrival.
 */
export function stepEnemyInterpolated(gs, e, dtSec) {
  // Initialize target to the center of the next greedy cell
  if (e.tx === undefined || e.ty === undefined) {
    const c = tileCenter(e.cx, e.cy);
    e.x = e.x ?? c.x; e.y = e.y ?? c.y;
    const { tx, ty } = chooseNextTargetGreedy(gs, e);
    e.tx = tx; e.ty = ty;
  }

  const dx = e.tx - e.x;
  const dy = e.ty - e.y;
  const dist = Math.hypot(dx, dy);

  const pxPerSec = (e.pxPerSec != null) ? e.pxPerSec : (e.speed * state.GRID.tile);
  const step = pxPerSec * dtSec;

  if (dist <= step) {
    // Snap and commit cell advance
    e.x = e.tx; e.y = e.ty;

    const dir = directionFromDelta(dx, dy) ?? e.dir;
    const { nx, ny } = stepFrom(e.cx, e.cy, dir);
    e.cx = nx; e.cy = ny; e.dir = dir;
    updateEnemyDistance(gs, e);

    // Immediately pick the next greedy target (adapts to any wall edit)
    const nxt = chooseNextTargetGreedy(gs, e);
    e.tx = nxt.tx; e.ty = nxt.ty;
  } else if (dist > 0) {
    e.x += (dx / dist) * step;
    e.y += (dy / dist) * step;
  }
}

function chooseNextTargetGreedy(gs, e) {
  const dir = chooseNextDirectionToExit(gs, e);
  const { nx, ny } = stepFrom(e.cx, e.cy, dir);
  const c = tileCenter(nx, ny);
  return { tx: c.x, ty: c.y, dir };
}

function tileCenter(cx, cy) {
  return {
    x: cx * state.GRID.tile + state.GRID.tile / 2,
    y: cy * state.GRID.tile + state.GRID.tile / 2,
  };
}

function directionFromDelta(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'E' : 'W';
  } else if (Math.abs(dy) > 0) {
    return dy > 0 ? 'S' : 'N';
  }
  return null;
}

/* =========================
 * Public convenience
 * ========================= */

/** Call on boot and after any edge toggle. */
export function recomputePath(gs = state.GameState) {
  // Keep existing distFromEntry for UI/shielding, and add distToExit for steering
  recomputeDistanceField(gs);
  recomputeExitField(gs);
  return gs.distToExit;
}

/** UI helper: list of open neighbors from a cell. */
export function openNeighbors(gs, x, y) {
  return state.neighborsByEdges(gs, x, y);
}

// Returns a list of open cells starting from EXIT and walking toward ENTRY,
// following the distance field downhill (i.e., away from the dragon).
export function raycastOpenCellsFromExit(gs, maxSteps) {
  const out = [];
  let cx = state.EXIT.x, cy = state.EXIT.y;

  for (let i = 0; i < maxSteps; i++) {
    // Choose the neighbor that DECREASES distFromEntry (toward ENTRY)
    const n = downhillNeighborTowardExit(gs, cx, cy);
    if (!n) break;
    out.push({ x: n.x, y: n.y, from: n.side });  // keep side for orientation
    cx = n.x; cy = n.y;
  }
  return out;
}

/** Greedy hint (if you need it elsewhere). */
export function downhillNeighborTowardExit(gs, x, y) {
  const D = gs.distToExit;
  const here = D?.[y]?.[x] ?? Infinity;
  let best = null, bestV = here, bestHeu = Infinity;
  const neigh = state.neighborsByEdges(gs, x, y);
  for (const n of neigh) {
    const v = D?.[n.y]?.[n.x];
    if (!isFinite(v)) continue;
    if (v < bestV) {
      bestV = v; best = n; bestHeu = manhattan(n.x, n.y, state.EXIT.x, state.EXIT.y);
    } else if (v === bestV) {
      const h = manhattan(n.x, n.y, state.EXIT.x, state.EXIT.y);
      if (h < bestHeu) { best = n; bestHeu = h; }
    }
  }
  return best; // may be null
}
