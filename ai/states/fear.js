// ai/states/fear.js
import { CFG } from '../config.js';
import { stepAlongDirection } from '../steering.js';
import * as state from '../../state.js';

export function enter(e, gs) {
  // ensure pixel coords exist so stepAlongDirection doesn't produce NaN
  if (typeof e.x !== 'number' || typeof e.y !== 'number') {
    const t = gs.tileSize || state.GRID.tile;
    const cx = Number.isInteger(e.cx) ? e.cx : (e.tileX | 0);
    const cy = Number.isInteger(e.cy) ? e.cy : (e.tileY | 0);
    e.x = (cx + 0.5) * t;
    e.y = (cy + 0.5) * t;
    e.tileX = cx;
    e.tileY = cy;
  }

  e.lastNonFearState ??= 'search';
  e.speedMul = CFG.FEAR_MUL;
}

export function update(e, gs, dt) {
  e.fearT = Math.max(0, (e.fearT || 0) - dt);
  const speed = e.speedBase * e.speedMul;
  stepAlongDirection(e, gs.time.dt, gs.tileSize || state.GRID.tile, speed);
  if (e.fearT <= 0) return e.lastNonFearState || 'search';
  return null;
}
