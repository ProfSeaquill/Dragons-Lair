// grid/walls.js — edge wall toggles + query, with connectivity guard
import * as state from '../state.js';
import { isEntryConnectedToExit } from '../ai/topology.js';

export function edgeHasWall(gs, x, y, side) {
  // In your model: "open" means no wall
  return !state.isOpen(gs, x, y, side);
}

export function toggleEdge(gs, x, y, side) {
  const before = edgeHasWall(gs, x, y, side);

  // Disallow edges that touch the dragon footprint
  if (edgeTouchesDragon(gs, x, y, side)) return;

  // Toggle
  state.setEdgeWall(gs, x, y, side, !before);

  // Prevent fully blocking entry ↔ exit; revert if it does
  const ok = isEntryConnectedToExit(gs, state.ENTRY, state.EXIT);
  if (!ok) {
    state.setEdgeWall(gs, x, y, side, before);
    return;
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
