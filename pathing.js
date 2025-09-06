// pathing.js
import { GRID, ENTRY, EXIT, GameState } from './state.js';

function inBounds(c, r) {
  return c >= 0 && r >= 0 && c < GRID.cols && r < GRID.rows;
}
function isWalkable(c, r) {
  return inBounds(c, r) && GameState.grid[r][c] === 0;
}

export function aStar(start, goal) {
  const open = new Set();
  const came = new Map();
  const gScore = new Map();
  const fScore = new Map();
  const key = (n) => `${n.c},${n.r}`;

  function h(n) { return Math.abs(n.c - goal.c) + Math.abs(n.r - goal.r); }
  function neighbors(n) {
    const arr = [
      { c: n.c + 1, r: n.r },
      { c: n.c - 1, r: n.r },
      { c: n.c,     r: n.r + 1 },
      { c: n.c,     r: n.r - 1 },
    ];
    return arr.filter(x => isWalkable(x.c, x.r));
  }

  const skey = key(start);
  open.add(skey);
  gScore.set(skey, 0);
  fScore.set(skey, h(start));

  const nodes = new Map();
  nodes.set(skey, start);
  nodes.set(key(goal), goal);

  while (open.size > 0) {
    // pick lowest fScore in open
    let currentKey = null; let best = Infinity;
    for (const k of open) {
      const fs = fScore.get(k) ?? Infinity;
      if (fs < best) { best = fs; currentKey = k; }
    }
    const current = nodes.get(currentKey);
    if (!current) break;

    // reached goal → reconstruct path
    if (current.c === goal.c && current.r === goal.r) {
      const out = [];
      let ck = currentKey;
      while (ck) {
        const n = nodes.get(ck);
        out.push({ c: n.c, r: n.r });
        ck = came.get(ck);
      }
      return out.reverse();
    }

    open.delete(currentKey);

    // relax neighbors
    for (const nb of neighbors(current)) {
      const nk = key(nb);
      nodes.set(nk, nb);
      const tentative = (gScore.get(currentKey) ?? Infinity) + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        came.set(nk, currentKey);
        gScore.set(nk, tentative);
        fScore.set(nk, tentative + h(nb));
        if (!open.has(nk)) open.add(nk);
      }
    }
  }

  return [];
}

export function recomputePath() {
  GameState.path = aStar(ENTRY, EXIT);
  return GameState.path.length > 0;
}

export function toggleWall(c, r) {
  if (c === ENTRY.c && r === ENTRY.r) return false;
  if (c === EXIT.c  && r === EXIT.r)  return false;
  const val = GameState.grid[r][c];
  GameState.grid[r][c] = val === 0 ? 1 : 0;
  const ok = recomputePath();
  if (!ok) {
    // revert if blocked
    GameState.grid[r][c] = val;
    recomputePath();
    return false;
  }
  return true;
}
