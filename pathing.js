// pathing.js — edge-walls pathing with live shortest-path-to-exit steering + success trail

import * as state from './state.js';

// ---------- Edge Toggling (UI hook) ----------
export function toggleEdge(gs, x, y, side, place = true) {
  // Bounds
  if (!state.inBounds(x, y)) {
    return { ok: false, reason: 'Out of bounds' };
  }

  // Cost check for placing
  if (place && !state.canAffordEdge(gs, true)) {
    return { ok: false, reason: 'Not enough bones' };
  }

  // Connectivity guard: don’t allow fully blocking entry↔exit
  if (wouldDisconnectEntryAndExit(gs, x, y, side, place)) {
    return { ok: false, reason: 'Would fully block the cave' };
  }

  // Apply symmetric edge wall
  const applied = state.setEdgeWall(gs, x, y, side, !!place);
  if (!applied) {
    return { ok: false, reason: 'Invalid neighbor' };
  }

  // Spend / refund bones
  if (place) state.spendBones(gs, state.COSTS.edgeWall);
  else       state.refundBones(gs, state.COSTS.edgeRefund);

  // Recompute distance fields so enemies immediately adapt
  recomputeDistanceField(gs);
  recomputeExitField(gs);
  // (Do NOT clear successTrail here; it should persist while enemies are alive.)

  return { ok: true };
}

/* =========================
 * Success Trail (herding)
 * ========================= */

function ensureSuccessField(gs = state.GameState) {
  if (!gs.successTrail ||
      gs.successTrail.length !== state.GRID.rows ||
      gs.successTrail[0]?.length !== state.GRID.cols) {
    gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0);
  }
  return gs.successTrail;
}

/** Increment trail intensity at a cell (call when an enemy ENTERS that cell). */
export function bumpSuccess(gs, cx, cy, amt = 1) {
  const T = ensureSuccessField(gs);
  if (state.inBounds(cx, cy)) T[cy][cx] = (T[cy][cx] || 0) + amt;
}

/** Reset the trail to all zeros (we’ll call this when field is clear). */
export function clearSuccessTrail(gs = state.GameState) {
  gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0);
  return gs.successTrail;
}

/* =========================
 * Distance Fields (BFS)
 * ========================= */

/** Recompute gs.distFromEntry[y][x]: shortest steps from ENTRY through open edges. */
export function recomputeDistanceField(gs = state.GameState) {
  gs.distFromEntry = bfsField(gs, state.ENTRY.x, state.ENTRY.y);
  return gs.distFromEntry;
}

/** Recompute gs.distToExit[y][x]: shortest steps TO EXIT (BFS from EXIT). */
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
 * Greedy-to-Exit Enemy API (with trail bias)
 * ========================= */

/** Keep per-tick cache of distance-from-entry (used by combat’s shield rules). */
export function updateEnemyDistance(gs, e) {
  if (state.inBounds(e.cx, e.cy)) {
    e.distFromEntry = gs.distFromEntry?.[e.cy]?.[e.cx] ?? Infinity;
  } else {
    e.distFromEntry = Infinity;
  }
}

export function chooseNextDirectionToExit(gs, e) {
  const D = gs.distToExit;
  if (!D) return e.dir || 'E';
  const T = gs.successTrail || (gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0));

  const x = e.cx | 0, y = e.cy | 0;
  const here = D?.[y]?.[x];
  if (!isFinite(here)) return heuristicFallback(gs, e);

  // Per-enemy weights (unitless)
  const b = e.behavior || {};
  const SENSE     = (b.sense     ?? 0.5);   // likes smaller D (toward exit)
  const HERDING   = (b.herding   ?? 1.0);   // likes stronger success trail
  const CURIOSITY = Math.min(0.15, (b.curiosity ?? 0.12)); // clamp jitter so it never overwhelms sense

  // Inertia
  const prevDir = e.dir || null;
  const STRAIGHT_BONUS    = 0.20;
  const BACKTRACK_PENALTY = 8.0;

  let bestDir = null;
  let bestScore = -Infinity;
  let bestD = Infinity; // for deterministic tie-breaks
  let bestStraight = false;

  const candidates = [
    ['N', x, y - 1],
    ['E', x + 1, y],
    ['S', x, y + 1],
    ['W', x - 1, y],
  ];

  for (const [dir, nx, ny] of candidates) {
    if (!state.isOpen(gs, x, y, dir)) continue;
    const d = D?.[ny]?.[nx];
    if (!isFinite(d)) continue;

    const delta = d - here;      // <0 downhill, 0 flat, >0 uphill
    if (delta >= 0) continue;    // STRICTLY DOWNHILL ONLY

    // Components
    const trail         = T?.[ny]?.[nx] || 0;
    const downhillScore =  SENSE   * (-delta); // larger drop in D is better
    const trailScore    =  HERDING * trail;
    const jitter        =  Math.random() * CURIOSITY;

    let inertia = 0;
    if (prevDir) {
      if (dir === prevDir) inertia += STRAIGHT_BONUS;
      if (isReverse(dir, prevDir)) inertia -= BACKTRACK_PENALTY;
    }

    const score = downhillScore + trailScore + inertia + jitter;

    // Primary: score; tie #1: steeper downhill (smaller d); tie #2: keep straight if possible
    const isStraight = (prevDir && dir === prevDir);
    if (
      score > bestScore ||
      (Math.abs(score - bestScore) < 1e-6 && (d < bestD || (d === bestD && isStraight && !bestStraight)))
    ) {
      bestScore = score;
      bestDir = dir;
      bestD = d;
      bestStraight = isStraight;
    }
  }

  return bestDir ?? heuristicFallback(gs, e);
}

function isReverse(a, b) {
  return (a === 'N' && b === 'S') || (a === 'S' && b === 'N') ||
         (a === 'E' && b === 'W') || (a === 'W' && b === 'E');
}


function heuristicFallback(gs, e) {
  // If no improving neighbor (rare), pick any open edge closer to EXIT (Manhattan)
  const ns = state.neighborsByEdges(gs, e.cx, e.cy);
  if (ns.length) {
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
  bumpSuccess(gs, e.cx, e.cy, 0.5); // lay a small trail as they move
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
    bumpSuccess(gs, e.cx, e.cy, 0.5); // trail breadcrumb
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
  ensureSuccessField(gs); // make sure the trail exists
  return gs.distToExit;
}

/** UI helper: list of open neighbors from a cell. */
export function openNeighbors(gs, x, y) {
  return state.neighborsByEdges(gs, x, y);
}

// Returns open cells starting from EXIT and walking toward ENTRY.
// Prefers to keep the same heading; only turns when straight is invalid.
// Never goes through walls; never steps "uphill" in the distance field.
export function raycastOpenCellsFromExit(gs, maxSteps) {
  const dist = gs?.distFromEntry;
  if (!dist) return [];

  const inBounds = (x, y) =>
    x >= 0 && y >= 0 && x < state.GRID.cols && y < state.GRID.rows;

  const openTo = (x, y, side) => {
    const cell = state.ensureCell(gs, x, y);
    return !cell?.[side];
  };

  const downhillNeighbors = (x, y) => {
    const d0 = dist?.[y]?.[x];
    if (!isFinite(d0)) return [];
    const cands = [
      { x: x + 1, y,   side: 'E' },
      { x: x - 1, y,   side: 'W' },
      { x,   y: y + 1, side: 'S' },
      { x,   y: y - 1, side: 'N' },
    ];
    const out = [];
    for (const nb of cands) {
      if (!inBounds(nb.x, nb.y)) continue;
      if (!openTo(x, y, nb.side)) continue;
      const dn = dist?.[nb.y]?.[nb.x];
      if (isFinite(dn) && dn < d0) out.push(nb);
    }
    return out;
  };

  const out = [];
  let cx = state.EXIT.x, cy = state.EXIT.y;

  // Seed heading by choosing the best downhill neighbor first.
  let nbs = downhillNeighbors(cx, cy);
  if (!nbs.length) return out;
  nbs.sort((a, b) => dist[a.y][a.x] - dist[b.y][b.x]);
  let hx = Math.sign(nbs[0].x - cx);
  let hy = Math.sign(nbs[0].y - cy);

  const MIN_STRAIGHT_STEPS = 2;
  let straightStreak = 0;

  for (let i = 0; i < maxSteps; i++) {
    nbs = downhillNeighbors(cx, cy);
    if (!nbs.length) break;

    const sx = cx + hx, sy = cy + hy;
    const straightSide =
      hx > 0 ? 'E' :
      hx < 0 ? 'W' :
      hy > 0 ? 'S' : 'N';

    const straightOK =
      inBounds(sx, sy) &&
      openTo(cx, cy, straightSide) &&
      dist[sy][sx] < dist[cy][cx];

    let next = null;

    if (straightOK && straightStreak < MIN_STRAIGHT_STEPS) {
      next = { x: sx, y: sy, side: straightSide };
      straightStreak++;
    } else {
      const straightInNbs = straightOK && nbs.find(nb => nb.x === sx && nb.y === sy);
      if (straightInNbs) {
        next = { x: sx, y: sy, side: straightSide };
        straightStreak++;
      } else {
        nbs.sort((a, b) => dist[a.y][a.x] - dist[b.y][b.x]);
        next = nbs[0];
        hx = Math.sign(next.x - cx);
        hy = Math.sign(next.y - cy);
        straightStreak = 0;
      }
    }

    out.push({
      x: next.x,
      y: next.y,
      dir: (hx !== 0 ? 'h' : 'v'),
      from: next.side,
    });

    cx = next.x; cy = next.y;
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
