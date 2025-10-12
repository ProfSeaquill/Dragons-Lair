// ai/states/attack.js
import * as state from '../../state.js';
import { nearestDragonCellTile } from '../perception.js';

function faceToward(e, tx, ty) {
  const dx = Math.sign(tx - e.tileX);
  const dy = Math.sign(ty - e.tileY);
  if (Math.abs(dx) >= Math.abs(dy)) { e.dirX = dx; e.dirY = 0; }
  else { e.dirX = 0; e.dirY = dy; }
}

export function enter(e, gs) {
  e.stateT = 0;
  e.speedMul = 0;           // stop movement while attacking
  e.isAttacking = true;
  e.commitDir = null;
  e.commitTilesLeft = 0;

  // ensure per-unit timer exists; jitter is OK for desync (already set in makeEnemy)
  if (typeof e.attackTimer !== 'number') {
    const rate = Math.max(0, e.rate || 0);
    e.attackTimer = rate > 0 ? (Math.random() * (1 / rate)) : 0;
  }

  // snap to tile center for stable visuals (optional)
  const t = gs.tileSize || state.GRID.tile;
  if (typeof e.x === 'number' && typeof e.y === 'number') {
    e.x = (e.tileX + 0.5) * t;
    e.y = (e.tileY + 0.5) * t;
  }

  // cache initial facing toward nearest dragon cell
  const { target } = nearestDragonCellTile(gs, e.tileX, e.tileY);
  if (target) faceToward(e, target.x, target.y);
}

export function update(e, gs, dt) {
  e.stateT += dt;

  // Stun/fear override
  if ((e.stunLeft|0) > 0) return null;  // let FSM priority switch to 'fear' if needed
  if (e.fearT > 0) return 'fear';

  // Engineers: skip melee; let other states handle (bombs, etc.)
  if (e.type === 'engineer' && e.tunneling) {
    e.isAttacking = false;
    return 'search';
  }

  const tx = Number.isInteger(e.tileX) ? e.tileX : (e.cx|0);
  const ty = Number.isInteger(e.tileY) ? e.tileY : (e.cy|0);
  const { target, manhattan } = nearestDragonCellTile(gs, tx, ty);
  const range = (typeof e.range === 'number') ? e.range : 1;

  // If we drifted out of range, leave attack state
  if (!target || manhattan > range) {
    e.isAttacking = false;
    e.speedMul = 1;
    return 'search'; // or 'charge' if you want immediate re-acquire
  }

  // Keep facing the target tile
  faceToward(e, target.x, target.y);

  // Tick the per-unit attack timer and fire discrete hits
  const rate = Math.max(0, e.rate || 0);      // attacks/sec
  const dmg  = Math.max(0, e.damage || 0);    // damage per hit
  if (rate <= 0 || dmg <= 0) return null;

  e.attackTimer -= dt;
  while (e.attackTimer <= 0) {
    // Apply one attack
    gs.dragonHP = Math.max(0, (gs.dragonHP | 0) - dmg);
    // (Optionally trigger hit feedback/telemetry here)
    // Refill timer for the next swing; preserve any overshoot for stable cadence
    e.attackTimer += (1 / rate);
  }

  return null; // stay in 'attack'
}
