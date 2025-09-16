// pathing.js — edge-walls pathing with local steering + persistent success trails

import * as state from './state.js';

/* =========================
 * Distance Fields (BFS)
 * ========================= */

// Keep entry distance for UI & hero shield ordering.
export function recomputeDistanceField(gs = state.GameState) {
  gs.distFromEntry = bfsField(gs, state.ENTRY.x, state.ENTRY.y);
  return gs.distFromEntry;
}

// Compatibility stub: we no longer steer via a global exit field.
// Leave a harmless field so callers don't crash.
export function recomputeExitField(gs = state.GameState) {
  gs.distToExit = null;
  return null;
}

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
 * Connectivity Guard (unchanged)
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
 * Edge toggling (recompute entry field; exit field is a no-op)
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

  if (place) state.spendBones(gs, state.COSTS.edgeWall);
  else state.refundBones(gs, state.COSTS.edgeRefund);

  // Update entry field; success trail stays (player wanted persistence).
  recomputeDistanceField(gs);
  recomputeExitField(gs); // harmless stub

  return { ok: true };
}

/* =========================
 * Success Trail (persistent, developer-controlled reset)
 * ========================= */

function ensureSuccessTrail(gs) {
  if (!gs.successTrail) {
    gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0);
  }
  return gs.successTrail;
}

/** Optional gentle decay per frame; safe to call from your main update. */
export function decaySuccessTrail(gs, dt, halfLifeSec = 12) {
  const grid = ensureSuccessTrail(gs);
  // Convert half-life to per-second decay factor
  const k = Math.pow(0.5, dt / Math.max(0.001, halfLifeSec));
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      row[x] *= k;
    }
  }
}

/** Clear trail entirely — call this when *no enemies remain* on the map. */
export function clearSuccessTrail(gs) {
  gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0);
}

/** Stamp the cell an enemy just entered. */
function stampTrail(gs, x, y, amount = 1) {
  const grid = ensureSuccessTrail(gs);
  if (!state.inBounds(x, y)) return;
  grid[y][x] = (grid[y][x] || 0) + amount;
}

/* =========================
 * Per-enemy “brain”
 * ========================= */

function initMind(e) {
  if (e.mind) return e.mind;
  // Deterministic-ish seed from spawn index if available, else Math.random
  const r = Math.random;
  e.mind = {
    // How strongly to prefer goal (closer to EXIT) vs other influences
    goalBias: 0.6 + 0.25 * r(),      // 0.6 .. 0.85
    // Random exploration weight
    curiosity: 0.05 + 0.20 * r(),    // 0.05 .. 0.25
    // How much to follow nearby allies’ flow
    herding: 0.3 + 0.4 * r(),        // 0.3 .. 0.7
    // “Sense” increases as you approach EXIT (we scale it in scoring)
    sense: 0.6 + 0.5 * r(),          // base multiplier
    // Short memory (don’t ping-pong)
    memoryCap: 6 + (r() * 4 | 0),    // 6..9 last tiles
  };
  e.recent = e.recent || []; // circular list of last coords (as "x,y")
  return e.mind;
}

function remember(e, x, y) {
  e.recent = e.recent || [];
  const k = `${x},${y}`;
  if (e.recent.length === 0 || e.recent[e.recent.length - 1] !== k) {
    e.recent.push(k);
    const cap = e.mind?.memoryCap || 8;
    if (e.recent.length > cap) e.recent.shift();
  }
}
function inRecent(e, x, y) {
  const k = `${x},${y}`;
  return Array.isArray(e.recent) && e.recent.includes(k);
}

/* =========================
 * Public enemy helpers
 * ========================= */

// Still used for hero shield ordering
export function updateEnemyDistance(gs, e) {
  if (state.inBounds(e.cx, e.cy)) {
    e.distFromEntry = gs.distFromEntry?.[e.cy]?.[e.cx] ?? Infinity;
  } else {
    e.distFromEntry = Infinity;
  }
}

// Compatibility name: now forwards to our local chooser
export function chooseNextDirectionToExit(gs, e) {
  return chooseNextDirection(gs, e);
}

/**
 * Core: choose next step using local scoring (no global exit BFS).
 * Score(open neighbor) = goalTerm + trailTerm + herdTerm + curiosityTerm − memoryPenalty
 */
export function chooseNextDirection(gs, e) {
  initMind(e);
  const mind = e.mind;

  const x = e.cx | 0, y = e.cy | 0;
  const ex = state.EXIT.x, ey = state.EXIT.y;

  const neigh = state.neighborsByEdges(gs, x, y);
  if (neigh.length === 0) return e.dir || 'E';

  // Sense increases closer to EXIT (Manhattan-based)
  const distM = Math.abs(ex - x) + Math.abs(ey - y);
  const senseScale = mind.sense * (1.2 + 1.0 / Math.max(1, distM)); // 2.2x near exit → fewer wrong turns

  // Herding: count allies in 2-tile radius and bias toward their most common direction
  let herdDir = null;
  if (Array.isArray(gs.enemies)) {
    const counts = { N:0,E:0,S:0,W:0 };
    for (const o of gs.enemies) {
      if (o === e) continue;
      if (Math.abs((o.cx|0) - x) + Math.abs((o.cy|0) - y) <= 2) {
        counts[o.dir || 'E'] = (counts[o.dir || 'E'] | 0) + 1;
      }
    }
    herdDir = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    herdDir = herdDir && herdDir[1] > 0 ? herdDir[0] : null;
  }

  const trail = ensureSuccessTrail(gs);

  // Evaluate candidates
  let best = null, bestScore = -Infinity, bestDir = e.dir || 'E';
  for (const n of neigh) {
    const nx = n.x, ny = n.y;

    // Goal: prefer Manhattan closer to EXIT
    const goalNow = Math.abs(ex - x) + Math.abs(ey - y);
    const goalNext = Math.abs(ex - nx) + Math.abs(ey - ny);
    const goalTerm = (goalNow - goalNext) * mind.goalBias * senseScale; // positive if we moved closer

    // Success trail: follow prior wins
    const trailTerm = (trail?.[ny]?.[nx] || 0) * 0.6;

    // Herding: small nudge if moving in the common local heading
    const dir = directionFromTo(x, y, nx, ny) || 'E';
    const herdTerm = (herdDir && dir === herdDir) ? mind.herding * 0.8 : 0;

    // Curiosity: tiny random spice per option (stable-ish via coords)
    const cur = pseudoNoise(nx, ny);
    const curiosityTerm = cur * mind.curiosity;

    // Memory penalty: avoid recently visited tiles
    const memPenalty = inRecent(e, nx, ny) ? 0.9 : 0; // subtract later

    const score = goalTerm + trailTerm + herdTerm + curiosityTerm - memPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = { nx, ny };
      bestDir = dir;
    }
  }

  return best ? bestDir : (e.dir || 'E');
}

function pseudoNoise(x, y) {
  // Simple deterministic-ish noise in 0..1 based on coords
  const s = Math.sin((x * 12.9898 + y * 78.233) * 43758.5453);
  return (s - Math.floor(s));
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

/* =========================
 * Movement (cell hop / pixel-smooth)
 * ========================= */

export function advanceEnemyOneCell(gs, e) {
  const dir = chooseNextDirection(gs, e);
  const { nx, ny } = stepFrom(e.cx, e.cy, dir);
  if (!state.inBounds(nx, ny)) return;
  e.cx = nx; e.cy = ny; e.dir = dir;
  remember(e, nx, ny);
  stampTrail(gs, nx, ny, 1);
  updateEnemyDistance(gs, e);
}

export function stepEnemyInterpolated(gs, e, dtSec) {
  if (e.tx === undefined || e.ty === undefined) {
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
    // Snap & commit
    e.x = e.tx; e.y = e.ty;

    const dir = directionFromDelta(dx, dy) ?? e.dir;
    const { nx, ny } = stepFrom(e.cx, e.cy, dir);
    if (state.inBounds(nx, ny)) {
      e.cx = nx; e.cy = ny; e.dir = dir;
      remember(e, nx, ny);
      stampTrail(gs, nx, ny, 1);
      updateEnemyDistance(gs, e);
    }

    // Next target via local chooser
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
  return { tx: c.x, ty: c.y, dir };
}

/* =========================
 * Public convenience
 * ========================= */

export function recomputePath(gs = state.GameState) {
  // Keep distFromEntry (UI/shields), no need for an exit field anymore.
  recomputeDistanceField(gs);
  recomputeExitField(gs);
  // Ensure success trail exists
  ensureSuccessTrail(gs);
  return gs.distFromEntry;
}

export function openNeighbors(gs, x, y) {
  return state.neighborsByEdges(gs, x, y);
}

// (Kept for any existing callers – still returns a downhill step, but now
//  uses the entry field as a soft hint only if present.)
export function downhillNeighborTowardExit(gs, x, y) {
  const ex = state.EXIT.x, ey = state.EXIT.y;
  const neigh = state.neighborsByEdges(gs, x, y);
  if (!neigh.length) return null;

  // Prefer Manhattan toward EXIT
  let best = neigh[0], bestH = manhattan(neigh[0].x, neigh[0].y, ex, ey);
  for (const n of neigh) {
    const h = manhattan(n.x, n.y, ex, ey);
    if (h < bestH) { bestH = h; best = n; }
  }
  return best;
}

/* =========================
 * Small helpers
 * ========================= */

function tileCenter(cx, cy) {
  return {
    x: cx * state.GRID.tile + state.GRID.tile / 2,
    y: cy * state.GRID.tile + state.GRID.tile / 2,
  };
}

function directionFromTo(x0, y0, x1, y1) {
  if (x1 === x0 && y1 === y0 - 1) return 'N';
  if (x1 === x0 + 1 && y1 === y0) return 'E';
  if (x1 === x0 && y1 === y0 + 1) return 'S';
  if (x1 === x0 - 1 && y1 === y0) return 'W';
  return null;
}

function directionFromDelta(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'E' : 'W';
  } else if (Math.abs(dy) > 0) {
    return dy > 0 ? 'S' : 'N';
  }
  return null;
}

function manhattan(x0, y0, x1, y1) {
  return Math.abs(x1 - x0) + Math.abs(y1 - y0);
}
