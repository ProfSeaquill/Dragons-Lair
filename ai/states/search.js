// ai/states/search.js

import { CFG } from '../config.js';
import { isDecisionNode, canAttackDragon, canSeeDragon } from '../perception.js';
import { stepAlongDirection, followPath } from '../steering.js';
import * as state from '../../state.js';

export function enter(e, gs) { e.speedMul = 1; }

export function update(e, gs, dt) {
  // Charge if dragon is seen
const tx = (e.tileX|0), ty = (e.tileY|0);
if (canSeeDragon(gs, tx, ty) && !canAttackDragon(gs, e)) return 'charge';

  const speed = (typeof e.speed === 'number' ? e.speed : e.speedBase);
  const tile = gs.tileSize || state.GRID.tile;

  // 1) Consume any forward planned edge path (from decision)
  if (e.path && e.path.length) {
    followPath(e, dt, tile, speed);
    // If we just arrived on a decision node, let decision record outcome & pick next
    if (isDecisionNode(gs, e.tileX|0, e.tileY|0) && e.commitTilesLeft <= 0) return 'decision';
    return null;
  }

  // 2) Consume any backtrack plan
  if (e.backtrackPath && e.backtrackPath.length) {
    const prevLen = e.backtrackPath.length;
    // temporarily swap to use followPath
    const save = e.path;
    e.path = e.backtrackPath;
    followPath(e, dt, tile, speed);
    e.backtrackPath = e.path;
    e.path = save;

    if (!e.backtrackPath || e.backtrackPath.length === 0) {
      // landed on the junction we wanted; trigger decision micro-delay
      return 'decision';
    }
    return null;
  }

  // 3) Normal forward motion with commit
  if (e.commitTilesLeft > 0) {
    // optional: decrement only at centers
    if ((e.x % tile === 0) && (e.y % tile === 0)) e.commitTilesLeft--;
  }
  if (isDecisionNode(gs, e.tileX | 0, e.tileY | 0) && e.commitTilesLeft <= 0) return 'decision';

  stepAlongDirection(e, dt, tile, speed);
  return null;
}
