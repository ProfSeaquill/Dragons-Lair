// pathing.js — edge-walls pathing & maze-walk AI

import * as state from './state.js';


/* =========================
 * Distance Field (BFS)
 * ========================= */

/**
 * Recompute gs.distFromEntry[y][x] as the shortest step distance from state.ENTRY,
 * traversing only through OPEN edges.
 * Infinity means unreachable.
 */
export function recomputeDistanceField(gs = state.GameState) {
  const W = state.GRID.cols, H = state.GRID.rows;
  const dist = state.makeScalarField(W, H, Infinity);
  const qx = new Array(W * H);
  const qy = new Array(W * H);
  let qh = 0, qt = 0;

  if (!state.inBounds(state.ENTRY.x, state.ENTRY.y)) {
    gs.distFromEntry = dist;
    return dist;
  }

  dist[state.ENTRY.y][state.ENTRY.x] = 0;
  qx[qt] = state.ENTRY.x; qy[qt] = state.ENTRY.y; qt++;

  while (qh < qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    const d = dist[y][x] + 1;
    // Explore via open edges
    if (state.isOpen(gs, x, y, 'N')) pushIfBetter(x, y - 1);
    if (state.isOpen(gs, x, y, 'E')) pushIfBetter(x + 1, y);
    if (state.isOpen(gs, x, y, 'S')) pushIfBetter(x, y + 1);
    if (state.isOpen(gs, x, y, 'W')) pushIfBetter(x - 1, y);

    function pushIfBetter(nx, ny) {
      if (!state.inBounds(nx, ny)) return;
      if (d < dist[ny][nx]) {
        dist[ny][nx] = d;
        qx[qt] = nx; qy[qt] = ny; qt++;
      }
    }
  }

  gs.distFromEntry = dist;
  return dist;
}

/* =========================
 * Connectivity Guard
 * ========================= */

/**
 * Quick BFS to check if state.EXIT remains reachable from state.ENTRY under an edge toggle.
 * We simulate the toggle in-memory (not applied) and test connectivity.
 * Returns true if toggle WOULD disconnect entry↔exit (i.e., should be blocked).
 */
export function wouldDisconnectEntryAndExit(gs, x, y, side, placeWall) {
  // Simulate: grab current edge states we will temporarily override
  const snap = snapshotEdgePair(gs, x, y, side);
  if (!applyEdgeSim(gs, x, y, side, !!placeWall)) return true;

  const ok = isReachable(gs, state.ENTRY.x, state.ENTRY.y, state.EXIT.x, state.EXIT.y);

  // Revert sim
  restoreEdgePair(gs, x, y, side, snap);
  return !ok;
}

function isReachable(gs, sx, sy, tx, ty) {
  if (!state.inBounds(sx, sy) || !state.inBounds(tx, ty)) return false;
  const W = state.GRID.cols, H = state.GRID.rows;
  const seen = new Uint8Array(W * H);
  const qx = new Array(W * H), qy = new Array(W * H);
  let qh = 0, qt = 0;

  seen[sy * W + sx] = 1;
  qx[qt] = sx; qy[qt] = sy; qt++;

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
    const idx = ny * W + nx;
    if (seen[idx]) return;
    seen[idx] = 1;
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

/**
 * Toggle an edge wall at (x,y,side).
 * - place=true  -> add a wall on that edge (and symmetric neighbor edge)
 * - place=false -> remove the wall
 * Enforces bones cost/refund and connectivity guard.
 * Returns { ok:boolean, reason?:string }
 */
export function toggleEdge(gs, x, y, side, place = true) {
  if (!state.inBounds(x, y)) return { ok: false, reason: 'Out of bounds' };

  // If placing, guard on affordability
  if (place && !state.canAffordEdge(gs, true)) {
    return { ok: false, reason: 'Not enough bones' };
  }

  // Connectivity guard: don’t allow fully blocking entry↔exit
  if (wouldDisconnectEntryAndExit(gs, x, y, side, place)) {
    return { ok: false, reason: 'Would fully block the cave' };
  }

  // Apply
  const applied = state.setEdgeWall(gs, x, y, side, !!place);
  if (!applied) return { ok: false, reason: 'Invalid neighbor' };

  // Spend / refund
  if (place) state.spendBones(gs, state.COSTS.edgeWall);
  else state.refundBones(gs, state.COSTS.edgeRefund);

  // Update distance field so UI/logic stay in sync
  recomputeDistanceField(gs);

  return { ok: true };
}

/* =========================
 * Maze-Walk Enemy API
 * ========================= */

/**
 * For enemies, we assume state.GRID-centric movement with facing.
 * Enemy fields expected/maintained here:
 *   e.cx, e.cy         // current cell coords (integers)
 *   e.dir              // 'N'|'E'|'S'|'W' current heading
 *   e.stack            // [{ x, y, tried:Set<'N'|'E'|'S'|'W'> }]
 *   e.distFromEntry    // convenience cache per tick
 *
 * You can initialize cx/cy/dir on spawn; we expose helpers below.
 */

const LEFT  = { N: 'W', W: 'S', S: 'E', E: 'N' };
const RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' };
const BACK  = { N: 'S', S: 'N', E: 'W', W: 'E' };

/**
 * Update e.distFromEntry from gs.distFromEntry (call each tick or after cell advance).
 */
export function updateEnemyDistance(gs, e) {
  if (state.inBounds(e.cx, e.cy)) {
    e.distFromEntry = gs.distFromEntry[e.cy][e.cx];
  } else {
    e.distFromEntry = Infinity;
  }
}

/**
 * Decide the next direction based on maze-walk rules:
 * 1) Try forward if open & not exhausted here,
 * 2) else try left or right (deterministic priority),
 * 3) else backtrack.
 * Keeps per-cell tried-directions in e.stack (for backtracking).
 */
export function chooseNextDirection(gs, e) {
  // Ensure current stack node
  const top = stackTopFor(e);

  // Preferred deterministic priority: forward > left > right > back
  const order = [
    e.dir,
    LEFT[e.dir],
    RIGHT[e.dir],
    BACK[e.dir],
  ];

  for (const dir of order) {
    if (top.tried.has(dir)) continue;        // already tried from this cell
    top.tried.add(dir);
    if (state.isOpen(gs, e.cx, e.cy, dir)) {
      return dir;
    }
  }

  // All tried in this cell — backtrack if possible
  if (e.stack.length > 1) {
    e.stack.pop();
    const prev = e.stack[e.stack.length - 1];
    // Heading becomes the direction from current to prev
    const dir = directionFromTo(e.cx, e.cy, prev.x, prev.y);
    return dir ?? BACK[e.dir]; // safe fallback
  }

  // Stuck at state.ENTRY or isolated: try any open edge to avoid deadlock
  const neigh = state.neighborsByEdges(gs, e.cx, e.cy);
  if (neigh.length) {
    const n = neigh[0];
    return directionFromTo(e.cx, e.cy, n.x, n.y) || e.dir;
  }

  return e.dir; // nowhere to go
}

function stackTopFor(e) {
  if (!e.stack || e.stack.length === 0) {
    e.stack = [{ x: e.cx, y: e.cy, tried: new Set() }];
  } else {
    const last = e.stack[e.stack.length - 1];
    if (last.x !== e.cx || last.y !== e.cy) {
      e.stack.push({ x: e.cx, y: e.cy, tried: new Set() });
    }
  }
  return e.stack[e.stack.length - 1];
}

function directionFromTo(x0, y0, x1, y1) {
  if (x1 === x0 && y1 === y0 - 1) return 'N';
  if (x1 === x0 + 1 && y1 === y0) return 'E';
  if (x1 === x0 && y1 === y0 + 1) return 'S';
  if (x1 === x0 - 1 && y1 === y0) return 'W';
  return null;
}

/**
 * Advance enemy by one state.GRID step (instant cell hop).
 * If you prefer pixel interpolation, wire `stepEnemyInterpolated` instead.
 */
export function advanceEnemyOneCell(gs, e) {
  const dir = chooseNextDirection(gs, e);
  const { nx, ny } = stepFrom(e.cx, e.cy, dir);
  if (!state.inBounds(nx, ny)) return; // clamp

  // Move and keep stack breadcrumbs
  e.cx = nx; e.cy = ny; e.dir = dir;
  // Refresh distance cache for ordering mechanics (shields, etc.)
  updateEnemyDistance(gs, e);
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
 * Optional helper for pixel-smooth movement along state.GRID centers.
 * Expects e.x/e.y in pixels, e.speed in tiles/sec (or pixels/sec if you pass state.GRID.tile-scaled).
 * - Locks targets to tile centers, walks center→center following maze-walk choices.
 */
export function stepEnemyInterpolated(gs, e, dtSec) {
  if (e.tx === undefined || e.ty === undefined) {
    // Initialize first target = current cell center
    const c = tileCenter(e.cx, e.cy);
    e.x = e.x ?? c.x; e.y = e.y ?? c.y;
    const { tx, ty } = chooseNextTarget(gs, e);
    e.tx = tx; e.ty = ty;
  }

  const dx = e.tx - e.x;
  const dy = e.ty - e.y;
  const dist = Math.hypot(dx, dy);

  const pxPerSec = (e.pxPerSec != null) ? e.pxPerSec : (e.speed * state.GRID.tile);
  const step = pxPerSec * dtSec;

  if (dist <= step) {
    // Snap to target cell center
    e.x = e.tx; e.y = e.ty;

    // Commit cell advance to (cx,cy) based on direction
    const dir = directionFromDelta(dx, dy) ?? e.dir;
    const { nx, ny } = stepFrom(e.cx, e.cy, dir);
    e.cx = nx; e.cy = ny; e.dir = dir;
    updateEnemyDistance(gs, e);

    // Pick next target
    const nxt = chooseNextTarget(gs, e);
    e.tx = nxt.tx; e.ty = nxt.ty;
  } else if (dist > 0) {
    e.x += (dx / dist) * step;
    e.y += (dy / dist) * step;
  }
}

function chooseNextTarget(gs, e) {
  const dir = chooseNextDirection(gs, e);
  const { nx, ny } = stepFrom(e.cx, e.cy, dir);
  const c = tileCenter(nx, ny);
  // Push breadcrumb when we commit to a new cell
  stackTopFor(e); // ensure current node exists
  // (We add the new node upon arrival in advanceEnemyOneCell/stepEnemyInterpolated)
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

/**
 * Call this on boot and after any edge toggle.
 * (Wrapper kept for drop-in replacement of older recomputePath APIs.)
 */
export function recomputePath(gs = state.GameState) {
  return recomputeDistanceField(gs);
}

/**
 * Utility for UI hover/preview: list of open neighbors from a cell.
 */
export function openNeighbors(gs, x, y) {
  return state.neighborsByEdges(gs, x, y);
}

/**
 * For AI/logic that wants a greedy hint toward exit (without A*):
 * returns best neighbor that strictly DECREASES distFromEntry (if any).
 */
export function downhillNeighborTowardExit(gs, x, y) {
  const here = gs.distFromEntry?.[y]?.[x] ?? Infinity;
  let best = null, bestD = here;
  const neigh = state.neighborsByEdges(gs, x, y);
  for (const n of neigh) {
    const d = gs.distFromEntry[n.y][n.x];
    if (d < bestD) { bestD = d; best = n; }
  }
  return best; // may be null
}
