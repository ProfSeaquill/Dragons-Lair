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

export function updateEnemyDistance(gs, e) {
  const cx = (typeof e.cx === 'number') ? Math.floor(e.cx) : NaN;
  const cy = (typeof e.cy === 'number') ? Math.floor(e.cy) : NaN;

  if (Number.isInteger(cx) && Number.isInteger(cy) && state.inBounds(cx, cy)) {
    e.distFromEntry = gs.distFromEntry?.[cy]?.[cx] ?? Infinity;
  } else {
    e.distFromEntry = Infinity;
  }
}


// softmax helper used by the steering policy
function softmaxSample(items, scoreKey, temperature = 1) {
  const eps = 1e-9;
  const exps = items.map(it => Math.exp((it[scoreKey] || 0) / Math.max(eps, temperature)));
  const sum = exps.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) return items[(Math.random() * items.length) | 0];
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= exps[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function chooseNextDirectionToExit(gs, e) {
  const D = gs.distToExit;
  if (!D) return e.dir || 'E';

  const cx = Math.floor(e.cx || 0);
  const cy = Math.floor(e.cy || 0);

  const neigh = state.neighborsByEdges(gs, cx, cy);
  if (!neigh || neigh.length === 0) return e.dir || 'E';

  // If a short commitment is active, prefer it while it's available
  if (e.commitDir && (e.commitSteps || 0) > 0) {
    const f = stepFrom(cx, cy, e.commitDir);
    if (state.inBounds(f.nx, f.ny) && state.isOpen(gs, cx, cy, e.commitDir)) {
      return e.commitDir;
    }
    // otherwise drop it if blocked
    e.commitDir = null;
    e.commitSteps = 0;
  }

  // identify previous cell (so we can avoid immediate backtracking at intersections)
  let prev = null;
  if (Number.isInteger(e.prevCX) && Number.isInteger(e.prevCY)) {
    prev = neigh.find(n => n.x === e.prevCX && n.y === e.prevCY) || null;
  }

  // ---------- Strong corridor rule: keep going straight when in a corridor ----------
  // Corridor = exactly 2 open neighbors and one is the previous cell -> continue to the other.
  if (prev && neigh.length === 2) {
    const other = neigh.find(n => !(n.x === prev.x && n.y === prev.y));
    if (other) return directionFromTo(cx, cy, other.x, other.y) || e.dir || 'E';
  }

  // If forward is open and we're not at an intersection, continue forward.
  if (e.dir) {
    const f = stepFrom(cx, cy, e.dir);
    const forwardOK = state.inBounds(f.nx, f.ny) && state.isOpen(gs, cx, cy, e.dir);
    if (forwardOK && neigh.length <= 2) return e.dir;
  }

  // ---------- Build candidate set (prefer not to immediately go back into prev) ----------
  let candidates = neigh.filter(n => !(prev && n.x === prev.x && n.y === prev.y));

  // If no candidate (dead-end), backtrack to prev
  if (candidates.length === 0) {
    if (prev) return directionFromTo(cx, cy, prev.x, prev.y) || e.dir || 'E';
    // fallback — should rarely happen
    return directionFromTo(cx, cy, neigh[0].x, neigh[0].y) || e.dir || 'E';
  }

  // ---------- Optional tiny random override ----------
  // Give a small guaranteed-explore chance (useful when scores are very lopsided).
  // Tied to curiosity so more curious units explore more.
  const btemp = e.behavior || {};
  const curiosityBase = Math.min(1, Math.max(0, btemp.curiosity ?? 0.12));
  // Small override probability (tunable). Use 0.08 - 0.35 range; scale with curiosity.
  const randOverrideProb = Math.min(0.35, 0.08 + curiosityBase * 0.45);
  if (Math.random() < randOverrideProb) {
    // pick uniformly at random among candidates (guaranteed exploration)
    const r = candidates[(Math.random() * candidates.length) | 0];
    // If at an intersection, set a short commit so they don't immediately flip around in a room.
    if (neigh.length >= 3) {
      e.commitDir = directionFromTo(cx, cy, r.x, r.y) || e.dir || 'E';
      e.commitSteps = Math.max(e.commitSteps || 0, 3); // try 3 tile commits; tune if desired
    }
    return directionFromTo(cx, cy, r.x, r.y) || e.dir || 'E';
  }

  // ---------- Score candidates using sense/herding/straight bias + tiny jitter ----------
  const here = D?.[cy]?.[cx] ?? Infinity;
  const T = gs.successTrail || (gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0));
  const SENSE   = (btemp.sense   ?? 0.5);
  const HERDING = (btemp.herding ?? 1.0);
  const CURIOSITY = curiosityBase;
  const STRAIGHT_BONUS = 0.18;

  const info = [];
  for (const c of candidates) {
    const nx = c.x, ny = c.y;
    const d = D?.[ny]?.[nx];
    if (!isFinite(d)) {
      info.push({ nx, ny, d: Infinity, score: -Infinity });
      continue;
    }
    const downhill = (isFinite(here) && isFinite(d)) ? (here - d) : 0;
    const trail = T?.[ny]?.[nx] || 0;
    // small centered jitter so scores are not identical; curiosity also affects softmax temperature below
    const jitter = (Math.random() - 0.5) * 0.02;
    let straightBonus = 0;
    if (e.dir) {
      const dirToC = directionFromTo(cx, cy, nx, ny);
      if (dirToC === e.dir) straightBonus = STRAIGHT_BONUS;
    }
    const score = SENSE * downhill + HERDING * trail + straightBonus + jitter;
    info.push({ nx, ny, d, score });
  }

  // Prefer reachable candidates for sampling
  const reachable = info.filter(it => isFinite(it.d));
  if (reachable.length === 0) {
    // fallback: pick any candidate
    const f = candidates[0];
    return directionFromTo(cx, cy, f.x, f.y) || e.dir || 'E';
  }

  // ---------- Softmax sampling: map curiosity -> temperature ----------
  // higher curiosity => higher temperature => more uniform sampling
  const temperature = 0.35 + CURIOSITY * 1.5; // tune if you want more/less randomness
  const chosen = softmaxSample(reachable, 'score', temperature);

  // If decision happens at an intersection/room, commit to the chosen direction for a few steps
  if (neigh.length >= 3) {
    const COMMIT_STEPS = 3; // 3 tile advances is a good default
    e.commitDir = directionFromTo(cx, cy, chosen.nx, chosen.ny) || e.dir || 'E';
    e.commitSteps = Math.max(e.commitSteps || 0, COMMIT_STEPS);
  }

  return directionFromTo(cx, cy, chosen.nx, chosen.ny) || e.dir || 'E';
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

export function stepEnemyInterpolated(gs, e, dtSec) {
  // Ensure dirLock and commit defaults
  if (typeof e.dirLockT !== 'number') e.dirLockT = 0;
  e.dirLockT = Math.max(0, e.dirLockT - dtSec);

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
    const { nx, ny } = stepFrom(Math.floor(e.cx), Math.floor(e.cy), dir);

    // Save previous cell coordinates for next decision
    e.prevCX = e.cx;
    e.prevCY = e.cy;

    e.cx = nx; e.cy = ny;

    // decrement commitment when we advanced one committed cell
    if (typeof e.commitSteps === 'number' && e.commitSteps > 0) {
      e.commitSteps = Math.max(0, e.commitSteps - 1);
      if (e.commitSteps === 0) {
        e.commitDir = null;
      }
    }

    // If the move changed facing, set a tiny lock to avoid instant flip-flop
    const oldDir = e.dir || null;
    e.dir = dir;
    if (oldDir && oldDir !== dir) {
      e.dirLockT = Math.max(e.dirLockT || 0, 0.12); // 120ms lock; tweak as needed
    }

    // Trail bump (reduce magnitude if earlier tests show runaway monopolies)
    bumpSuccess(gs, e.cx, e.cy, 0.12);

    updateEnemyDistance(gs, e);

    // Immediately pick the next greedy target (adapts to wall edits)
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
