// pathing.test.js — pathing/AI invariants
import test from 'node:test';
import assert from 'node:assert/strict';

import * as state from '../state.js';
import {
  toggleEdge,
  wouldDisconnectEntryAndExit,
  chooseNextDirectionToExit,
  recomputePath,
} from './pathing.js';

function fresh(gs = state.GameState) {
  state.resetState(gs);
  // generous bones so cost checks never block the tests
  gs.bones = 1_000_000;
  recomputePath(gs);
  return gs;
}

test('toggleEdge never lets you fully block Entry ↔ Exit', () => {
  const gs = fresh();

  // Build a vertical barrier at the middle; the last piece should be refused
  const midCol = Math.floor(state.GRID.cols / 2) - 1;
  let okCount = 0, failCount = 0;

  for (let y = 0; y < state.GRID.rows; y++) {
    const res = toggleEdge(gs, midCol, y, 'E', true); // place = true
    if (res?.ok) okCount++; else failCount++;
  }

  // At least one edge placement must be refused to preserve connectivity
  assert.ok(okCount < state.GRID.rows, 'At least one segment must be refused');
  assert.ok(failCount >= 1, 'Refusal should have occurred for the last blocking segment');
});

test('wouldDisconnectEntryAndExit flags the last gap of a barrier', () => {
  const gs = fresh();

  const midCol = Math.floor(state.GRID.cols / 2) - 1;
  const gapY = Math.floor(state.GRID.rows / 2); // leave a single opening

  // Place all segments except one gap
  for (let y = 0; y < state.GRID.rows; y++) {
    if (y === gapY) continue;
    const res = toggleEdge(gs, midCol, y, 'E', true);
    assert.ok(res.ok, `segment (${midCol},${y},E) should place`);
  }

  // Now, closing the gap should be detected as disconnecting
  const wouldBlock = wouldDisconnectEntryAndExit(gs, midCol, gapY, 'E', true);
  assert.equal(wouldBlock, true, 'closing the last gap must be detected as disconnecting');

  // And toggleEdge should refuse it in practice
  const res = toggleEdge(gs, midCol, gapY, 'E', true);
  assert.equal(res.ok, false, 'toggleEdge should refuse a fully-blocking edge');
});

test('In a straight corridor, enemy keeps direction until a node/topology change', () => {
  const gs = fresh();

  // Build a 1-tile-high horizontal corridor across the ENTRY row:
  const y = state.ENTRY.y;
  for (let x = 0; x < state.GRID.cols; x++) {
    // ceiling and floor walls for a straight corridor
    if (y - 1 >= 0) toggleEdge(gs, x, y, 'N', true);
    if (y + 1 < state.GRID.rows) toggleEdge(gs, x, y, 'S', true);
  }
  recomputePath(gs);

  // Drop an enemy into the corridor, facing east (toward exit)
  const e = { cx: Math.max(1, state.ENTRY.x + 2), cy: y, dir: 'E' };

  // In a corridor (degree==2) with no visible topology change ahead, keep going straight
  const dir = chooseNextDirectionToExit(gs, e);
  assert.equal(dir, 'E', 'Enemy should prefer to keep going straight in a corridor');
});
