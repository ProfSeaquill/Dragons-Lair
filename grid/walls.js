// grid/walls.js — edge wall toggles + query, with connectivity guard
import * as state from '../state.js';
import * as topology from '../ai/topology.js';

// Example toggle that prevents full block:
export function toggleEdge(gs, x, y, side, forcePlace /* optional boolean */) {
  const here = state.ensureCell(gs, x, y);
  const curr = !!here[side];
  const next = (typeof forcePlace === 'boolean') ? !!forcePlace : !curr;
  
  if (next === curr) return { ok: true, changed: false };

  // Tentatively apply
  state.setEdgeWall(gs, x, y, side, next);
  bumpTopologyRevision(gs);   // new
  
  // Connectivity guard
  const connected = topology.isEntryConnectedToExit(gs);
  if (!connected) {
    state.setEdgeWall(gs, x, y, side, curr); // revert
    return { ok: false, changed: false, reason: 'disconnect' };
  }

  state.bumpTopology(gs, 'walls:toggleEdge');
  return { ok: true, changed: true };
}

export function edgeHasWall(gs, x, y, side) {
  const c = state.ensureCell(gs, x, y);
  return !!c[side];
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
