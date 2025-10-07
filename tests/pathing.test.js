// pathing.test.js — topology & pathing invariants (FSM-friendly)
// Run with: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import * as state from '../state.js';
import { isEntryConnectedToExit } from '../ai/topology.js';
import { toggleEdge, edgeHasWall } from '../grid/walls.js';

// --- Test helpers ---
function fresh(gs = state.GameState) {
  state.resetState(gs);
  // plenty of bones so UI-style costs never block (some UIs check this)
  gs.bones = 1_000_000;
  // no global recomputePath anymore — just bump topology once (harmless)
  gs.topologyVersion = (gs.topologyVersion || 0) + 1;
  return gs;
}

// "Place if absent" (since toggleEdge() is a toggle, not an explicit setter).
function placeEdge(gs, x, y, side) {
  if (!edgeHasWall(gs, x, y, side)) {
    toggleEdge(gs, x, y, side); // attempt to place
  }
  return edgeHasWall(gs, x, y, side);
}

// "Remove if present"
function removeEdge(gs, x, y, side) {
  if (edgeHasWall(gs, x, y, side)) {
    toggleEdge(gs, x, y, side);
  }
  return !edgeHasWall(gs, x, y, side);
}

test('toggleEdge never lets you fully block Entry ↔ Exit', () => {
  const gs = fresh();

  // Build a vertical barrier near the middle; the last piece(s) must be refused.
  const midCol = Math.floor(state.GRID.cols / 2) - 1;

  let placed = 0;
  for (let y = 0; y < state.GRID.rows; y++) {
    const ok = placeEdge(gs, midCol, y, 'E'); // try to place the east edge
    if (ok) placed++;
  }

  // Still connected after all attempts:
  assert.equal(
    isEntryConnectedToExit(gs, state.ENTRY, state.EXIT),
    true,
    'Entry ↔ Exit must remain connected'
  );

  // At least one placement should have been refused to preserve connectivity:
  assert.ok(
    placed < state.GRID.rows,
    'At least one segment must be refused (cannot fully block)'
  );
});

test('closing the last gap of a barrier is refused', () => {
  const gs = fresh();
  const midCol = Math.floor(state.GRID.cols / 2) - 1;
  const gapY = Math.floor(state.GRID.rows / 2);

  // Place all segments except one gap
  for (let y = 0; y < state.GRID.rows; y++) {
    if (y === gapY) continue;
    const ok = placeEdge(gs, midCol, y, 'E');
    assert.ok(ok, `segment (${midCol},${y},E) should place before the gap is closed`);
  }

  // Now attempt to close the last gap — should be refused (edge remains absent)
  const before = edgeHasWall(gs, midCol, gapY, 'E');
  assert.equal(before, false, 'gap edge should be absent before placement');

  toggleEdge(gs, midCol, gapY, 'E'); // try to place the final blocking edge

  const after = edgeHasWall(gs, midCol, gapY, 'E');
  assert.equal(after, false, 'closing the last gap must be refused');

  // Connectivity must remain true
  assert.equal(
    isEntryConnectedToExit(gs, state.ENTRY, state.EXIT),
    true,
    'Connectivity must remain after refused placement'
  );
});

test('A straight corridor has degree 2 at interior tiles (edge-aware neighbors)', () => {
  const gs = fresh();

  // Build a 1-tile-high horizontal corridor along the ENTRY row by walling top+bottom
  const y = state.ENTRY.y;
  for (let x = 0; x < state.GRID.cols; x++) {
    if (y - 1 >= 0) placeEdge(gs, x, y, 'N'); // ceiling
    if (y + 1 < state.GRID.rows) placeEdge(gs, x, y, 'S'); // floor
  }
  gs.topologyVersion = (gs.topologyVersion || 0) + 1;

  // For interior cells along the corridor, the graph degree should be exactly 2
  // when using edge-aware neighbors.
  const first = 1;
  const last = state.GRID.cols - 2;

  for (let x = first; x <= last; x++) {
    const neigh = state.neighborsByEdges(gs, x, y);
    assert.equal(
      neigh.length, 2,
      `corridor interior at (${x},${y}) should have exactly 2 open neighbors`
    );
  }

  // And start/end of the corridor should have <= 2 neighbors (not >2)
  {
    const n0 = state.neighborsByEdges(gs, first, y).length;
    const n1 = state.neighborsByEdges(gs, last, y).length;
    assert.ok(n0 <= 2 && n1 <= 2, 'corridor endpoints should not exceed degree 2');
  }
});
