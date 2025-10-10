import { CFG } from '../config.js';
import { isJunction, canSeeDragon } from '../perception.js';
import { stepAlongDirection } from '../steering.js';

export function enter(e, gs) {
  e.speedMul = 1;
}

export function update(e, gs, dt) {
  // Promotion to Charge if dragon is seen
    if (canSeeDragon(gs, e.cx | 0, e.cy | 0)) return 'charge';

  // Keep moving forward unless at junction or commit expires
  if (e.commitTilesLeft > 0) {
    e.commitTilesLeft -= reachedTileCenterThisFrame(e, gs) ? 1 : 0;
  }
    const atJunction = isJunction(gs, e.tileX | 0, e.tileY | 0);
  if (atJunction && e.commitTilesLeft <= 0) return 'decision';

    const speed = (e.speedBase ?? e.speed ?? 1) * e.speedMul;
  stepAlongDirection(e, gs.time.dt, gs.tileSize, speed);
  return null;
}

// Helper to decrement commit only on tile centers (optional, add your own detection)
function reachedTileCenterThisFrame(e, gs){
  // if your movement snaps to centers, replace with your own check
  return (e.x % gs.tileSize === 0) && (e.y % gs.tileSize === 0);
}
