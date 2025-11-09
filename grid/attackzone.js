// grid/attackzone.js
// 3-tile vertical "attack zone" immediately WEST of the dragon footprint.
// Reuses the same footprint math you already use elsewhere.

import { inBounds, dragonCells } from '../state.js';

/** Compute the west band geometry once (x column + y span). */
function dragonWestBand(gs) {
  const cells = dragonCells(gs);
  let minX = Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { bandX: (minX|0) - 1, minY: (minY|0), maxY: (maxY|0) };
}

/** Fast test: is (cx,cy) in the west 3×1 column touching the dragon? */
export function isInAttackZone(gs, cx, cy) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
  const { bandX, minY, maxY } = dragonWestBand(gs);
  if (!inBounds(bandX, cy)) return false;
  return cx === bandX && cy >= minY && cy <= maxY;
}
