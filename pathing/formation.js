// pathing/formation.js
// Column/stack formation: followers step into the predecessor’s previous tile.
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - followDelayTicks:  Add a small delay before each follower starts moving,
//                      to create small gaps in the column (0 = tight stack).
// - blockingPolicy:    If a predecessor’s previous tile is currently occupied
//                      or impassable, follower waits (simple & safe). You can
//                      customize to try micro detours, but column means “wait”.
// - ordering:          The group array MUST be ordered [leader, f1, f2, ...].
// ──────────────────────────────────────────────────────────────────────────────

import { isPassable } from "../grid/walls.js";

// TUNABLE: small per-follower start delay in ticks (e.g., [0,0,0] = tight stack).
// Length should be >= group size; extra entries are ignored.
export const followDelayTicks = [0, 0, 0, 0, 0, 0, 0, 0, 0];

// Internal snapshot of “start-of-tick” positions.
let _prev = [];

/** Call at the START of a tick, before moving the leader. 
 *  `group` is an array ordered [leader, follower1, follower2, ...],
 *  and each unit has integer `x`, `y` fields.
 */
export function beginTickSnapshot(group) {
  _prev.length = group.length;
  for (let i = 0; i < group.length; i++) {
    const u = group[i];
    _prev[i] = { x: u.x | 0, y: u.y | 0, wait: u._followWait | 0 };
  }
}

/** Move followers one step to their predecessor’s previous tile (if possible).
 *  Call this AFTER the leader has moved one tile for the current tick.
 *  Each unit may also carry a private `_followWait` counter (managed here).
 */
export function stepFollowers(group) {
  if (!group || group.length <= 1) return;

  // Ensure wait counters exist
  for (let i = 0; i < group.length; i++) {
    const u = group[i];
    if (u._followWait == null) u._followWait = followDelayTicks[i] | 0;
  }

  // Followers run front→back so each uses the predecessor's _prev position.
  for (let i = 1; i < group.length; i++) {
    const follower = group[i];
    // Honor delay ticks
    if (follower._followWait > 0) {
      follower._followWait--;
      continue;
    }

    const predPrev = _prev[i - 1];         // predecessor's previous position
    const targetX = predPrev.x, targetY = predPrev.y;

    // BLOCKING POLICY: only move if passable AND not currently occupied
    if (!isPassable(targetX, targetY)) continue;
    if (isOccupied(group, targetX, targetY)) continue;

    // Also: avoid swapping with own predecessor if they didn't move this tick
    const stillAtPrev = (group[i - 1].x === predPrev.x && group[i - 1].y === predPrev.y);
    if (stillAtPrev) continue;

    // Move exactly one tile (the previous tile of predecessor)
    follower.x = targetX;
    follower.y = targetY;
  }
}

/** Optional helper: did anyone in the group occupy (x,y) AFTER leader move? */
function isOccupied(group, x, y) {
  for (let i = 0; i < group.length; i++) {
    const u = group[i];
    if ((u.x | 0) === x && (u.y | 0) === y) return true; // current positions
  }
  return false;
}

/** Reset any internal state (e.g., on wave start or respawn). */
export function resetFormation(group) {
  _prev.length = 0;
  if (group) for (const u of group) u._followWait = 0;
}
