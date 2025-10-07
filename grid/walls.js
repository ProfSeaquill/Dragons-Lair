// grid/walls.js — edge wall toggles + query, with connectivity guard
import * as state from '../state.js';
import * as topology from '../ai/topology.js';

// Example toggle that prevents full block:
export function toggleEdge(gs, x, y, side, forcePlace /* optional boolean */) {
  // current state
  const here = state.ensureCell(gs, x, y);
  const curr = !!here[side];

  const next = (typeof forcePlace === 'boolean') ? !!forcePlace : !curr;

  // Fast no-op
  if (next === curr) return { ok: true, changed: false };

  // Tentatively apply
  state.setEdgeWall(gs, x, y, side, next);

  // Don’t allow fully blocking entry↔exit
  const connected = topology.isEntryConnectedToExit(gs);
  if (!connected) {
    // revert
    state.setEdgeWall(gs, x, y, side, curr);
    return { ok: false, changed: false, reason: 'disconnect' };
  }

  return { ok: true, changed: true };
}

export function edgeHasWall(gs, x, y, side) {
  const c = state.ensureCell(gs, x, y);
  return !!c[side];
}

  // Nudge topology so any path caches refresh
  gs.topologyVersion = (gs.topologyVersion || 0) + 1;
}

function edgeTouchesDragon(gs, x, y, side) {
  const a = { x, y };
  const b = { x, y };
  if (side === 'N') b.y = y - 1;
  if (side === 'S') b.y = y + 1;
  if (side === 'W') b.x = x - 1;
  if (side === 'E') b.x = x + 1;
  return state.isDragonCell(a.x, a.y, gs) || state.isDragonCell(b.x, b.y, gs);
}
