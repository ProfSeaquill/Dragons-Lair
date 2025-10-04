// pathing.barrier.test.js — you must not be able to fully block Entry ↔ Exit
import test from 'node:test';
import assert from 'node:assert/strict';

import * as state from '../state.js';
import { toggleEdge, recomputePath } from '../pathing.js';

// Helper: ensure an edge exists (true) or is removed (false)
function ensureEdge(gs, x, y, side, shouldExist) {
  const has = edgeHasWall(gs, x, y, side);
  if (has !== shouldExist) toggleEdge(gs, x, y, side);
  return edgeHasWall(gs, x, y, side);
}

// Helper: check if EXIT is reachable from ENTRY using your distance field
function exitReachable(gs) {
  recomputePath(gs);
  const d = gs.distFromEntry;
  return Number.isFinite(d?.[state.EXIT.y]?.[state.EXIT.x]);
}

test('Cannot fully block Entry ↔ Exit with a continuous wall', () => {
  const gs = state.GameState;

  // Pick a center-ish column and try to seal it with EAST edges
  const col = Math.max(0, Math.floor(state.GRID.cols / 2) - 1);

  // Track which segments we successfully placed so we can clean them up
  const placed = [];

  try {
    let placedCount = 0;
    for (let y = 0; y < state.GRID.rows; y++) {
      const ok = ensureEdge(gs, col, y, 'E', true);
      if (ok) {
        placed.push([col, y, 'E']);
        placedCount++;
      }
    }

    // After attempts, EXIT must still be reachable
    assert.equal(exitReachable(gs), true, 'Exit must remain reachable after wall attempts');

    // At least one segment should have been refused to preserve connectivity
    assert.ok(
      placedCount < state.GRID.rows,
      `Expected at least one segment refusal; placed=${placedCount}, rows=${state.GRID.rows}`
    );
  } finally {
    // Cleanup: remove any edges we placed so other tests (later) start clean
    for (const [x, y, side] of placed) ensureEdge(gs, x, y, side, false);
    recomputePath(gs);
  }
});
