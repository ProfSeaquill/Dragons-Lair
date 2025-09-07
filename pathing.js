// pathing.js — A* pathfinding and wall placement with A* guard

import { GRID, ECON, hasWall, placeWall, removeWall } from './state.js';

// ---- Basics ----
const key = (x, y) => `${x},${y}`;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < GRID.W && y < GRID.H;
const isWalkable = (gs, x, y) => inBounds(x, y) && !gs.walls.has(key(x, y));

function entryExit() {
  // Default entry/exit if not stored elsewhere: middle-left → middle-right
  return {
    entry: { x: 0, y: Math.floor(GRID.H / 2) },
    exit:  { x: GRID.W - 1, y: Math.floor(GRID.H / 2) },
  };
}

// 4-neighborhood
function neighbors(gs, n) {
  const cand = [
    { x: n.x + 1, y: n.y },
    { x: n.x - 1, y: n.y },
    { x: n.x,     y: n.y + 1 },
    { x: n.x,     y: n.y - 1 },
  ];
  return cand.filter(p => isWalkable(gs, p.x, p.y));
}

const H = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// ---- A* (grid, 4-dir) ----
function aStar(gs, start, goal) {
  const open = new Set();
  const came = new Map();      // childK -> parentK
  const g = new Map();         // nodeK -> gScore
  const f = new Map();         // nodeK -> fScore
  const nodes = new Map();     // nodeK -> {x,y}

  const sK = key(start.x, start.y);
  const tK = key(goal.x, goal.y);

  open.add(sK);
  nodes.set(sK, start);
  nodes.set(tK, goal);
  g.set(sK, 0);
  f.set(sK, H(start, goal));

  while (open.size) {
    // pick node in open with smallest f
    let curK = null, curF = Infinity;
    for (const k of open) {
      const fk = f.get(k) ?? Infinity;
      if (fk < curF) { curF = fk; curK = k; }
    }
    const cur = nodes.get(curK);
    if (!cur) break;

    if (curK === tK) {
      // reconstruct
      const out = [];
      let k = curK;
      while (k) {
        const n = nodes.get(k);
        out.push({ x: n.x, y: n.y });
        k = came.get(k);
      }
      return out.reverse();
    }

    open.delete(curK);

    for (const nb of neighbors(gs, cur)) {
      const nK = key(nb.x, nb.y);
      nodes.set(nK, nb);
      const tentative = (g.get(curK) ?? Infinity) + 1;
      if (tentative < (g.get(nK) ?? Infinity)) {
        came.set(nK, curK);
        g.set(nK, tentative);
        f.set(nK, tentative + H(nb, goal));
        if (!open.has(nK)) open.add(nK);
      }
    }
  }

  return [];
}

// ---- Public: recomputePath(gs) ----
export function recomputePath(gs) {
  const { entry, exit } = entryExit();
  gs.path = aStar(gs, entry, exit);
  return Array.isArray(gs.path) && gs.path.length > 0;
}

// ---- Public: toggleWall(gs, x, y, place) ----
// Returns: 'ok' | 'blocked' | 'no-bones' | 'occupied' | 'empty'
export function toggleWall(gs, x, y, place) {
  const { entry, exit } = entryExit();

  if (!inBounds(x, y)) return 'blocked';
  // Never allow walls on entry/exit
  if ((x === entry.x && y === entry.y) || (x === exit.x && y === exit.y)) return 'blocked';

  const already = hasWall(gs, x, y);

  if (place) {
    if (already) return 'occupied';
    if ((gs.bones | 0) < ECON.WALL_COST) return 'no-bones';

    // Place tentatively
    placeWall(gs, x, y);
    gs.bones = (gs.bones | 0) - ECON.WALL_COST;

    // Path must remain valid
    if (!recomputePath(gs)) {
      // Revert
      removeWall(gs, x, y);
      gs.bones = (gs.bones | 0) + ECON.WALL_COST;
      recomputePath(gs);
      return 'blocked';
    }
    return 'ok';
  } else {
    if (!already) return 'empty';

    // Remove
    removeWall(gs, x, y);
    gs.bones = (gs.bones | 0) + ECON.WALL_REFUND;

    // Recompute (should always be valid after removing)
    recomputePath(gs);
    return 'ok';
  }
}
