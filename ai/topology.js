// ai/topology.js
import * as state from '../state.js';

// Edge-aware 4-neighbors: only cross edges that are open according to gs.cellWalls
export function neighbors4(gs, x, y) {
  const out = [];
  if (state.isOpen(gs, x, y, 'N')) out.push({ x,     y: y - 1 });
  if (state.isOpen(gs, x, y, 'E')) out.push({ x: x+1, y      });
  if (state.isOpen(gs, x, y, 'S')) out.push({ x,     y: y + 1 });
  if (state.isOpen(gs, x, y, 'W')) out.push({ x: x-1, y      });
  return out;
}

// BFS flood from one or more start tiles; returns distance field
export function floodFrom(gs, starts) {
  const startList = Array.isArray(starts) ? starts
                    : (starts && typeof starts === 'object') ? [starts]
                    : [ state.EXIT ]; // default: from EXIT
  const w = state.GRID.cols, h = state.GRID.rows;
  const dist = state.makeScalarField(w, h, Infinity);

  const q = [];
  for (const s of startList) {
    if (!state.inBounds(s.x, s.y)) continue;
    dist[s.y][s.x] = 0;
    q.push({ x: s.x, y: s.y });
  }

  let head = 0;
  while (head < q.length) {
    const { x, y } = q[head++];
    const d = dist[y][x];
    for (const n of neighbors4(gs, x, y)) {
      if (dist[n.y][n.x] > d + 1) {
        dist[n.y][n.x] = d + 1;
        q.push(n);
      }
    }
  }
  return dist;
}

export function ensureFreshTopology(gs) {
  const tv  = (gs.topologyVersion | 0);
  const cur = gs.topology ? (gs.topology.version | 0) : -1;
  if (!gs.topology || cur !== tv) {
    const topo = buildJunctionGraph(gs);
    topo.version = tv;      // mirror the flag
    gs.topology = topo;     // the ONLY place that assigns
  }
}


// Connectivity check: is ENTRY reachable from EXIT given current edge walls?
export function isEntryConnectedToExit(gs, entry = state.ENTRY, exit = state.EXIT) {
  const D = floodFrom(gs, exit);
  const v = D?.[entry.y]?.[entry.x];
  return Number.isFinite(v);
}

// Degree at a tile (how many open edges)
export function cellDegree(gs, x, y) {
  return neighbors4(gs, x, y).length;
}

// Build a shortest path from (sx,sy) to the nearest of `targets`
// Defaults to the dragon footprint cells.
export function computeShortestPath(
  gs,
  sx,
  sy,
  targets = state.dragonCells(gs)
) {
  // Distance field seeded from targets (0 at targets, increasing outward)
  const dist = floodFrom(gs, targets);
  if (!state.inBounds(sx, sy)) return null;
  const d0 = dist?.[sy]?.[sx];
  if (!Number.isFinite(d0)) return null; // start not reachable

  // Pick the best target by distance (usually one of the dragon cells)
  let best = null, bestD = Infinity;
  for (const t of targets) {
    const v = dist?.[t.y]?.[t.x];
    if (Number.isFinite(v) && v < bestD) { bestD = v; best = t; }
  }
  if (!best) return null;

  // Reconstruct path by stepping to any neighbor with a strictly smaller dist
  const path = [{ x: sx, y: sy }];
  let x = sx, y = sy;
  let guard = state.GRID.cols * state.GRID.rows + 5;

  while (guard-- > 0) {
    const d = dist[y][x];
    if (d === 0) break; // reached a target
    let next = null, bestV = d;

    for (const n of neighbors4(gs, x, y)) {
      const v = dist[n.y][n.x];
      if (Number.isFinite(v) && v < bestV) { bestV = v; next = n; }
    }
    if (!next) break; // dead end (shouldn't happen if d was finite)
    x = next.x; y = next.y;
    path.push({ x, y });
  }
  return path;
}

// --- Junction graph (nodes: degree!=2 tiles; edges: corridor runs) ---
export function junctionId(x,y){ return `${x},${y}`; }

export function buildJunctionGraph(gs) {
  const w = state.GRID.cols, h = state.GRID.rows;
  const isNode = (x,y) => {
    if (!state.inBounds(x,y)) return false;
    const deg = cellDegree(gs, x, y);
    return deg !== 2; // junctions and dead-ends both count as "nodes"
  };

  const jxns = new Map();

  // Discover nodes
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    if (isNode(x,y)) {
      const id = junctionId(x,y);
      if (!jxns.has(id)) jxns.set(id, { id, x, y, exits: [], version: (gs.topologyVersion|0) });
    }
  }

  // For each node, follow each open direction until next node or stop
  const dirs = [{d:'N',dx:0,dy:-1},{d:'E',dx:1,dy:0},{d:'S',dx:0,dy:1},{d:'W',dx:-1,dy:0}];
 for (const node of jxns.values()) {
  for (const dir of dirs) {
    const d = dir.d;
    let sdx = dir.dx, sdy = dir.dy;                              // ← mutable step vectors
    if (!state.isOpen(gs, node.x, node.y, d)) continue;

    // step out
    let x = node.x + sdx, y = node.y + sdy;
    const run = [];
    let guard = w * h + 5;

    while (guard-- > 0) {
      if (!state.inBounds(x,y)) break;
      run.push({ x, y });
      if (isNode(x,y)) {
        const toId = junctionId(x,y);
        node.exits.push({ dir: d, to: toId, path: run.slice() });
        break;
      }

      // continue corridor
      const options = [];
      if (state.isOpen(gs, x, y, 'N')) options.push({dx:0, dy:-1, s:'N'});
      if (state.isOpen(gs, x, y, 'E')) options.push({dx:1, dy:0,  s:'E'});
      if (state.isOpen(gs, x, y, 'S')) options.push({dx:0, dy:1,  s:'S'});
      if (state.isOpen(gs, x, y, 'W')) options.push({dx:-1,dy:0,  s:'W'});

      const bx = -sdx, by = -sdy;                                 // ← use sdx/sdy
      const next = options.find(o => !(o.dx === bx && o.dy === by));
      if (!next) break;

      x += next.dx; y += next.dy;
      sdx = next.dx; sdy = next.dy;                               // ← update mutable vectors
    }
  }
}

    const topo = { version: (gs.topologyVersion|0), jxns };
  return topo; // ← do NOT assign to gs or bump the flag here
}
