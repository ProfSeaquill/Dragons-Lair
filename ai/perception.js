// ai/perception.js
import * as state from '../state.js';
import { neighbors4 } from './topology.js';

// “Visible” neighbors respecting edge walls
export function visibleNeighbors(gs, cx, cy) {
  if (!state.inBounds(cx, cy)) return [];
  return neighbors4(gs, cx, cy);
}

// Simple BFS list of reachable cells from EXIT (useful for previews, etc.)
export function reachableFromExit(gs) {
  const key = (x,y) => `${x},${y}`;
  const seen = new Set();
  const out = [];
  const q = [{ x: state.EXIT.x, y: state.EXIT.y }];
  seen.add(key(q[0].x, q[0].y));

  while (q.length) {
    const p = q.shift();
    out.push(p);
    for (const n of neighbors4(gs, p.x, p.y)) {
      const k = key(n.x, n.y);
      if (!seen.has(k)) { seen.add(k); q.push(n); }
    }
  }
  return out;
}
