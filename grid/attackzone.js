// grid/attackzone.js
// 3-tile vertical "attack zone" immediately WEST of the dragon footprint.
// Reuses the same footprint math you already use elsewhere.

import { inBounds, dragonCells, GRID } from '../state.js';

/** Compute the west band geometry once (x column + y span). */
function dragonWestBand(gs) {
  const cells = dragonCells(gs);
  let minX = Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
   // band column immediately WEST of the dragon’s west face
  const bandX = Math.max(0, (minX | 0) - 1);
  const y0 = Math.max(0, (minY | 0));
  const y1 = Math.min((GRID.rows | 0) - 1, (maxY | 0));
  return { bandX, minY: y0, maxY: y1 };
}
}

/** Fast test: is (cx,cy) in the west 3×1 column touching the dragon? */
export function isInAttackZone(gs, cx, cy) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
  const { bandX, minY, maxY } = dragonWestBand(gs);
  if (!inBounds(bandX, cy)) return false;
  return cx === bandX && cy >= minY && cy <= maxY;
}
