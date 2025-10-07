import { CFG } from '../config.js';
import { stepAlongDirection } from '../steering.js';

export function enter(e, gs) {
  e.lastNonFearState ??= 'search';
  e.speedMul = CFG.FEAR_MUL;
}

export function update(e, gs, dt) {
  // Decision has higher priority globally; this state's update won’t be called if FSM chooses Decision
  e.fearT -= dt;
  const speed = e.speedBase * e.speedMul;
  stepAlongDirection(e, gs.time.dt, gs.tileSize, speed);
  if (e.fearT <= 0) return e.lastNonFearState || 'search';
  return null;
}
