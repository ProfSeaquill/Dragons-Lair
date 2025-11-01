// ai/states/search.js
import { isDecisionNode, canAttackDragon, canSeeDragon } from '../perception.js';
import { stepAlongDirection, followPath } from '../steering.js';
import * as state from '../../state.js';

const sideOf = (dir) => (dir === 'E' ? 'E' : dir === 'W' ? 'W' : dir === 'S' ? 'S' : 'N');

export function enter(e, gs) { e.speedMul = 1; }

export function update(e, gs, dt) {
  // Charge if dragon is seen
  const tx = (e.tileX | 0), ty = (e.tileY | 0);
  if (canSeeDragon(gs, tx, ty) && !canAttackDragon(gs, e)) return 'charge';

  const speed = (typeof e.speed === 'number' ? e.speed : e.speedBase);
  const tile = gs.tileSize || state.GRID.tile;

  // 1) Consume any forward planned path (from decision)
  if (e.path && e.path.length) {
    followPath(e, dt, tile, speed);

    // If followPath discovered a block, pivot immediately into decision
    if (e._blockedForward) {
      e._blockedForward = false;
      return 'decision';
    }

    return null;
  }

  // 2) Consume any backtrack plan
  if (e.backtrackPath && e.backtrackPath.length) {
    const save = e.path;
    e.path = e.backtrackPath;
    followPath(e, dt, tile, speed);
    e.backtrackPath = e.path;
    e.path = save;

    if (!e.backtrackPath || e.backtrackPath.length === 0) {
      // landed on the junction we wanted; trigger decision micro-delay
      return 'decision';
    }

    if (e.backtrackPath && e.backtrackPath[0]) {
      const p = e.backtrackPath[0];
      const T = state.GameState.successTrail;
      if (T?.[p.y]?.[p.x] != null) T[p.y][p.x] += 0.15;
    }
    return null;
  }

  // 3) Normal forward motion with commit (robust)

  // 3a) If we’re on a decision node and not committed, go decide.
  if (isDecisionNode(gs, e.tileX | 0, e.tileY | 0) && (e.commitTilesLeft | 0) <= 0) {
    return 'decision';
  }

  // 3b) If we’re still committed, but the edge in front is blocked, drop the commit and decide.
  if ((e.commitTilesLeft | 0) > 0 && Number.isInteger(e.tileX) && Number.isInteger(e.tileY)) {
    const side = sideOf(e.dir);
    if (!state.isOpen(gs, e.tileX, e.tileY, side)) {
      e.commitTilesLeft = 0;
      return 'decision';
    }
  }

  // 3c) Step forward; if blocked this frame, trigger decision immediately.
  const prevTX = e.tileX | 0, prevTY = e.tileY | 0;
  stepAlongDirection(e, dt, tile, speed);

  if (e._blockedForward) {
    e._blockedForward = false; // consume the flag
    return 'decision';
  }

  // Ensure tile indices exist (defensive)
  if (!Number.isInteger(e.tileX) || !Number.isInteger(e.tileY)) {
    e.tileX = Math.floor((e.x || 0) / tile);
    e.tileY = Math.floor((e.y || 0) / tile);
  }

  // 3d) Commit accounting: decrement when we actually ENTER a new tile.
  if ((e.commitTilesLeft | 0) > 0) {
    const nowTX = e.tileX | 0, nowTY = e.tileY | 0;
    if (nowTX !== prevTX || nowTY !== prevTY) {
      e.commitTilesLeft = Math.max(0, (e.commitTilesLeft | 0) - 1);
    }
  }

  // 3e) If we arrived at a decision node and our commit has just run out, go decide next.
  if (isDecisionNode(gs, e.tileX | 0, e.tileY | 0) && (e.commitTilesLeft | 0) <= 0) {
    return 'decision';
  }

  return null;
}
