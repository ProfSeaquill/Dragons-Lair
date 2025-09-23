// pathing.js — edge-walls pathing with live shortest-path-to-exit steering,
// success trail, room/corridor/junction classification, per-enemy memory, and
// forward-vision gating so enemies only "decide" when progress may be blocked.

import * as state from './state.js';

/* =========================
 * Tunables (global to this module)
 * ========================= */

// Room detection
const ROOM_FLOOD_RADIUS = 3;
const ROOM_SIZE_THRESHOLD = 10;

// Per-enemy memory / vision
const VISION_TILES = 3;            // how many tiles to look ahead when evaluating a candidate
const MEMORY_PENALTY = 0.6;        // subtract this from score if immediate target tile was visited
const FORWARD_UNVISITED_BONUS = 0.25; // add this per unvisited tile in look-ahead
const VISITED_CAP = 200;           // max tiles remembered per enemy
const MEMORY_DECAY_MS = 60_000;    // optional: expire visited marks older than this (ms)

/* =========================
 * Edge toggling (UI hook)
 * ========================= */

export function toggleEdge(gs, x, y, side, place = true) {
  if (!state.inBounds(x, y)) {
    return { ok: false, reason: 'Out of bounds' };
  }
  if (place && !state.canAffordEdge(gs, true)) {
    return { ok: false, reason: 'Not enough bones' };
  }
  if (wouldDisconnectEntryAndExit(gs, x, y, side, place)) {
    return { ok: false, reason: 'Would fully block the cave' };
  }

  const applied = state.setEdgeWall(gs, x, y, side, !!place);
  if (!applied) return { ok: false, reason: 'Invalid neighbor' };

  if (place) state.spendBones(gs, state.COSTS.edgeWall);
  else       state.refundBones(gs, state.COSTS.edgeRefund);

  // Recompute pathing artifacts (distance fields + cell-type classification)
  recomputeDistanceField(gs);
  recomputeExitField(gs);
  computeCellTypes(gs);

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

export function bumpSuccess(gs, cx, cy, amt = 1) {
  const T = ensureSuccessField(gs);
  if (state.inBounds(cx, cy)) T[cy][cx] = (T[cy][cx] || 0) + amt;
}

export function clearSuccessTrail(gs = state.GameState) {
  gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0);
  return gs.successTrail;
}

/* =========================
 * Distance fields (BFS)
 * ========================= */

export function recomputeDistanceField(gs = state.GameState) {
  gs.distFromEntry = bfsField(gs, state.ENTRY.x, state.ENTRY.y);
  return gs.distFromEntry;
}

export function recomputeExitField(gs = state.GameState) {
  gs.distToExit = bfsField(gs, state.EXIT.x, state.EXIT.y);
  return gs.distToExit;
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
    if (state.isOpen(gs, x, y, 'W')) push(x, y - 1);
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
 * Map classification: rooms/corridors/junctions/deadends
 * ========================= */

/**
 * BFS-limited flood that returns a Set of "x,y" reachable from (sx,sy) within maxSteps.
 * If full=true, floods the entire connected component (no depth limit).
 */
export function floodRegion(gs, sx, sy, maxSteps = ROOM_FLOOD_RADIUS, full = false) {
  const W = state.GRID.cols, H = state.GRID.rows;
  const seen = new Uint8Array(W * H);
  const qx = [], qy = [], qd = [];
  qx.push(sx); qy.push(sy); qd.push(0);
  seen[sy * W + sx] = 1;
  const set = new Set([`${sx},${sy}`]);

  for (let qi = 0; qi < qx.length; qi++) {
    const x = qx[qi], y = qy[qi], d = qd[qi];
    if (!full && d >= maxSteps) continue;
    const neigh = state.neighborsByEdges(gs, x, y);
    for (const n of neigh) {
      const nx = n.x, ny = n.y;
      if (!state.inBounds(nx, ny)) continue;
      const idx = ny * W + nx;
      if (seen[idx]) continue;
      seen[idx] = 1;
      qx.push(nx); qy.push(ny); qd.push(d + 1);
      set.add(`${nx},${ny}`);
    }
  }
  return set;
}

/** Count unique exit tiles adjacent to a region (region is Set of "x,y"). */
export function countRegionExits(gs, regionSet) {
  const exitTiles = new Set();
  for (const key of regionSet) {
    const [sx, sy] = key.split(',').map(n => +n);
    const neigh = state.neighborsByEdges(gs, sx, sy);
    for (const n of neigh) {
      const nx = n.x, ny = n.y;
      const nk = `${nx},${ny}`;
      if (!regionSet.has(nk)) exitTiles.add(nk);
    }
  }
  return { exits: exitTiles.size, exitTiles };
}

/**
 * Analyze region: returns { size, bbox, exits, exitTiles, regionSet }.
 * If full=true, computes full connected component, otherwise bounded by maxSteps.
 */
export function analyzeRegion(gs, sx, sy, maxSteps = ROOM_FLOOD_RADIUS, full = false) {
  const region = floodRegion(gs, sx, sy, maxSteps, full);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of region) {
    const [x, y] = k.split(',').map(n => +n);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const exitsInfo = countRegionExits(gs, region);
  return {
    size: region.size,
    bbox: { minX, minY, maxX, maxY, w: (maxX - minX + 1), h: (maxY - minY + 1) },
    exits: exitsInfo.exits,
    exitTiles: exitsInfo.exitTiles,
    regionSet: region,
  };
}

/**
 * Compute gs.cellType[y][x] with values:
 *  'corridor' | 'junction' | 'room_multi' | 'room_deadend' | 'room_enclosed' | 'deadend'
 *
 * This is relatively cheap for small grids and is called after recomputePath.
 */
export function computeCellTypes(gs = state.GameState) {
  const W = state.GRID.cols, H = state.GRID.rows;
  const types = new Array(H);
  for (let y = 0; y < H; y++) {
    const row = new Array(W);
    for (let x = 0; x < W; x++) row[x] = 'corridor';
    types[y] = row;
  }

  const visited = new Set();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      if (!state.inBounds(x, y)) { types[y][x] = 'deadend'; visited.add(key); continue; }

      const neigh = state.neighborsByEdges(gs, x, y);
      const deg = neigh.length;

      if (deg <= 1) {
        types[y][x] = 'deadend';
        visited.add(key);
        continue;
      }

      // Quick local openness measure
      const regionLocal = floodRegion(gs, x, y, ROOM_FLOOD_RADIUS, false);
      const area = regionLocal.size;

      if (area >= ROOM_SIZE_THRESHOLD) {
        // compute full connected region for accuracy and exit count
        const fullInfo = analyzeRegion(gs, x, y, ROOM_FLOOD_RADIUS, true);

        // decide room subtype using exit count
        if (fullInfo.exits >= 2) {
          // multi-exit room
          for (const k of fullInfo.regionSet) {
            const [rx, ry] = k.split(',').map(n => +n);
            types[ry][rx] = 'room_multi';
            visited.add(k);
          }
        } else if (fullInfo.exits === 1) {
          for (const k of fullInfo.regionSet) {
            const [rx, ry] = k.split(',').map(n => +n);
            types[ry][rx] = 'room_deadend';
            visited.add(k);
          }
        } else {
          // isolated/enclosed
          for (const k of fullInfo.regionSet) {
            const [rx, ry] = k.split(',').map(n => +n);
            types[ry][rx] = 'room_enclosed';
            visited.add(k);
          }
        }
        continue;
      }

      // area small -> not a room; classify by degree
      if (deg >= 3) {
        types[y][x] = 'junction';
      } else {
        // deg === 2 is corridor-like
        types[y][x] = 'corridor';
      }
      visited.add(key);
    }
  }

  gs.cellType = types;
  return types;
}

/* =========================
 * Enemy helpers (distance cache)
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

/* =========================
 * Per-enemy memory helpers
 * ========================= */

function ensureVisitedStruct(e) {
  if (!e) return;
  if (!e._visitedSet) {
    e._visitedSet = new Set();
    e._visitedOrder = [];
    e._visitedAt = Object.create(null);
  }
}

function recordVisitForEnemy(e, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  ensureVisitedStruct(e);
  const k = state.tileKey(x, y);
  if (!e._visitedSet.has(k)) {
    e._visitedSet.add(k);
    e._visitedOrder.push(k);
    e._visitedAt[k] = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    if (e._visitedOrder.length > VISITED_CAP) {
      const old = e._visitedOrder.shift();
      if (old) {
        e._visitedSet.delete(old);
        delete e._visitedAt[old];
      }
    }
  } else {
    // refresh timestamp so decay behaves nicely
    e._visitedAt[k] = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  }
}

function isVisitedByEnemy(e, x, y) {
  if (!e || !e._visitedSet) return false;
  const k = state.tileKey(x, y);
  if (MEMORY_DECAY_MS > 0 && e._visitedAt && e._visitedAt[k] != null) {
    const age = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - e._visitedAt[k];
    if (age > MEMORY_DECAY_MS) {
      // expire
      e._visitedSet.delete(k);
      delete e._visitedAt[k];
      const idx = e._visitedOrder.indexOf(k);
      if (idx >= 0) e._visitedOrder.splice(idx, 1);
      return false;
    }
  }
  return e._visitedSet.has(k);
}

/* =========================
 * Steering helpers
 * ========================= */

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

/**
 * Decide next grid direction for an enemy using:
 * - short-commit (commitDir / commitSteps)
 * - corridor continuation (prev + degree)
 * - forward-vision gating: if forward is clear for several tiles, keep straight
 * - otherwise: softmax over candidate directions using downhill (toward exit),
 *   herding (successTrail), straight bonus, per-enemy visited penalties, forward-unvisited bonus,
 *   and a small curiosity-driven rand override.
 */
export function chooseNextDirectionToExit(gs, e) {
  const D = gs.distToExit;
  if (!D) return e.dir || 'E';

  const cx = Math.floor(e.cx || 0), cy = Math.floor(e.cy || 0);
  const neigh = state.neighborsByEdges(gs, cx, cy);
  if (!neigh || neigh.length === 0) return e.dir || 'E';

  // honor short commitment
  if (e.commitDir && (e.commitSteps || 0) > 0) {
    const f = stepFrom(cx, cy, e.commitDir);
    if (state.inBounds(f.nx, f.ny) && state.isOpen(gs, cx, cy, e.commitDir)) return e.commitDir;
    e.commitDir = null; e.commitSteps = 0;
  }

  // previous cell (if any)
  let prev = null;
  if (Number.isInteger(e.prevCX) && Number.isInteger(e.prevCY)) {
    prev = neigh.find(n => n.x === e.prevCX && n.y === e.prevCY) || null;
  }

  // Corridor rule: exactly 2 neighbors and one is prev -> continue to the other
  if (prev && neigh.length === 2) {
    const other = neigh.find(n => !(n.x === prev.x && n.y === prev.y));
    if (other) return directionFromTo(cx, cy, other.x, other.y) || e.dir || 'E';
  }

  // Forward check (one tile)
  let forwardOK = false;
  if (e.dir) {
    const f = stepFrom(cx, cy, e.dir);
    forwardOK = state.inBounds(f.nx, f.ny) && state.isOpen(gs, cx, cy, e.dir);
  }

  // cell type
  const ttype = gs.cellType?.[cy]?.[cx] || 'corridor';

  // helper: detect blocked within vision (if there's a wall in the current heading within VISION_TILES)
  function blockedWithinVision(gs, cx, cy, dir, vision) {
    if (!dir) return false;
    let tx = cx, ty = cy;
    for (let i = 0; i < vision; i++) {
      const s = stepFrom(tx, ty, dir);
      if (!state.inBounds(s.nx, s.ny)) return true;
      if (!state.isOpen(gs, tx, ty, dir)) return true;
      tx = s.nx; ty = s.ny;
    }
    return false;
  }

  // If forward is OK and not blocked soon, keep going straight (fast-path).
  const blockedSoon = !forwardOK || blockedWithinVision(gs, cx, cy, e.dir, VISION_TILES);
  if (!blockedSoon && forwardOK && prev) {
    return e.dir;
  }

  // Build candidates excluding prev (avoid immediate backtrack at junctions)
  let candidates = neigh.filter(n => !(prev && n.x === prev.x && n.y === prev.y));
  if (candidates.length === 0) {
    if (prev) return directionFromTo(cx, cy, prev.x, prev.y) || e.dir || 'E';
    return directionFromTo(cx, cy, neigh[0].x, neigh[0].y) || e.dir || 'E';
  }

  // If tile is a deadend or room_deadend -> prefer deterministic exit
  if (ttype === 'deadend' || ttype === 'room_deadend') {
    const info = analyzeRegion(gs, cx, cy, ROOM_FLOOD_RADIUS, true);
    if (info.exits === 1) {
      for (const c of candidates) {
        const key = `${c.x},${c.y}`;
        if (info.exitTiles.has(key)) {
          e.commitDir = directionFromTo(cx, cy, c.x, c.y) || e.dir || 'E';
          e.commitSteps = Math.max(e.commitSteps || 0, 3);
          return e.commitDir;
        }
      }
    }
  }

  // Decision point: apply behavior
  const b = e.behavior || {};
  const curiosityBase = Math.min(1, Math.max(0, b.curiosity ?? 0.12));
  const randOverrideProb = Math.min(0.35, 0.08 + curiosityBase * 0.45);

  // small guaranteed exploratory override (curiosity)
  if (Math.random() < randOverrideProb) {
    const r = candidates[(Math.random() * candidates.length) | 0];
    if (neigh.length >= 3) {
      const commitByType = { corridor: 0, junction: 3, room_multi: 4, room_deadend: 3, room_enclosed: 3, deadend: 0 };
      e.commitDir = directionFromTo(cx, cy, r.x, r.y) || e.dir || 'E';
      e.commitSteps = Math.max(e.commitSteps || 0, commitByType[ttype] || 3);
    }
    return directionFromTo(cx, cy, r.x, r.y) || e.dir || 'E';
  }

  // Score candidates using downhill (sense), trail (herding), straight bias, small jitter,
  // and add per-enemy memory penalty + forward-unvisited bonus.
  const here = D?.[cy]?.[cx] ?? Infinity;
  const T = gs.successTrail || (gs.successTrail = state.makeScalarField(state.GRID.cols, state.GRID.rows, 0));
  const SENSE = (b.sense ?? 0.5);
  const HERDING = (b.herding ?? 1.0);
  const STRAIGHT_BONUS = 0.40;

  const info = [];
  for (const c of candidates) {
    const nx = c.x, ny = c.y;
    const d = D?.[ny]?.[nx];
    if (!isFinite(d)) { info.push({ nx, ny, d: Infinity, score: -Infinity }); continue; }
    const downhill = (isFinite(here) && isFinite(d)) ? (here - d) : 0;
    const trail = T?.[ny]?.[nx] || 0;
    const jitter = (Math.random() - 0.5) * 0.02;
    let straightBonus = 0;
    if (e.dir && directionFromTo(cx, cy, nx, ny) === e.dir) straightBonus = STRAIGHT_BONUS;

    // Per-enemy memory penalty for the immediate candidate tile
    const immediateVisited = isVisitedByEnemy(e, nx, ny) ? 1 : 0;
    const visitedPenalty = immediateVisited ? MEMORY_PENALTY : 0;

    // Forward-unvisited count in candidate dir (scan up to VISION_TILES)
    let forwardUnvisited = 0;
    const candidateDir = directionFromTo(cx, cy, nx, ny);
    let scanX = nx, scanY = ny;
    for (let L = 0; L < VISION_TILES; L++) {
      // if out-of-bounds or blocked from this scan cell in candidateDir, stop scanning further
      if (!state.inBounds(scanX, scanY)) break;
      if (!isVisitedByEnemy(e, scanX, scanY)) forwardUnvisited++;
      const st = stepFrom(scanX, scanY, candidateDir);
      if (!state.inBounds(st.nx, st.ny)) break;
      if (!state.isOpen(gs, scanX, scanY, candidateDir)) break;
      scanX = st.nx; scanY = st.ny;
    }

    const score = SENSE * downhill + HERDING * trail + straightBonus + jitter
                - visitedPenalty
                + (FORWARD_UNVISITED_BONUS * forwardUnvisited);

    info.push({ nx, ny, d, score });
  }

  const reachable = info.filter(it => isFinite(it.d));
  if (reachable.length === 0) {
    const f = candidates[0];
    return directionFromTo(cx, cy, f.x, f.y) || e.dir || 'E';
  }

  const temperature = 0.35 + curiosityBase * 1.5;
  const chosen = softmaxSample(reachable, 'score', temperature);

  // commit length mapping by tile type
  if (neigh.length >= 3) {
    const commitByType = { corridor: 0, junction: 3, room_multi: 4, room_deadend: 3, room_enclosed: 3, deadend: 0 };
    e.commitDir = directionFromTo(cx, cy, chosen.nx, chosen.ny) || e.dir || 'E';
    e.commitSteps = Math.max(e.commitSteps || 0, commitByType[ttype] || 3);
  }

  return directionFromTo(cx, cy, chosen.nx, chosen.ny) || e.dir || 'E';
}

/* =========================
 * Fallback heuristics & small utilities
 * ========================= */

function heuristicFallback(gs, e) {
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

/* =========================
 * Movement API
 * ========================= */

export function advanceEnemyOneCell(gs, e) {
  const dir = chooseNextDirectionToExit(gs, e);
  const { nx, ny } = stepFrom(e.cx, e.cy, dir);
  if (!state.inBounds(nx, ny)) return;
  e.cx = nx; e.cy = ny; e.dir = dir;
  bumpSuccess(gs, e.cx, e.cy, 0.5);
  // record visit for memory (so teleport-style moves also record)
  recordVisitForEnemy(e, e.cx, e.cy);
  updateEnemyDistance(gs, e);
}

export function stepEnemyInterpolated(gs, e, dtSec) {
  if (typeof e.dirLockT !== 'number') e.dirLockT = 0;
  e.dirLockT = Math.max(0, e.dirLockT - dtSec);

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
    e.x = e.tx; e.y = e.ty;

    const dir = directionFromDelta(dx, dy) ?? e.dir;
    const { nx, ny } = stepFrom(Math.floor(e.cx), Math.floor(e.cy), dir);

    e.prevCX = e.cx;
    e.prevCY = e.cy;

    e.cx = nx; e.cy = ny;

    // record visit for per-enemy memory (bounded)
    recordVisitForEnemy(e, e.cx, e.cy);

    if (typeof e.commitSteps === 'number' && e.commitSteps > 0) {
      e.commitSteps = Math.max(0, e.commitSteps - 1);
      if (e.commitSteps === 0) e.commitDir = null;
    }

    const oldDir = e.dir || null;
    e.dir = dir;
    if (oldDir && oldDir !== dir) {
      e.dirLockT = Math.max(e.dirLockT || 0, 0.12);
    }

    bumpSuccess(gs, e.cx, e.cy, 0.12);
    updateEnemyDistance(gs, e);

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

export function openNeighbors(gs, x, y) {
  return state.neighborsByEdges(gs, x, y);
}

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
  return best;
}

/** Call on boot and after any edge toggle. */
export function recomputePath(gs = state.GameState) {
  recomputeDistanceField(gs);
  recomputeExitField(gs);
  ensureSuccessField(gs);
  computeCellTypes(gs);
  return gs.distToExit;
}
