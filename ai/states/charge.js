import { CFG } from '../config.js';
import { followPath } from '../steering.js';
import { computeShortestPath } from '../topology.js';

export function enter(e, gs) {
  e.speedMul = CFG.CHARGE_MUL;
  e.path = computeShortestPath(gs.grid, [e.tileX,e.tileY], [gs.dragon.tileX, gs.dragon.tileY]);
  e._topoOnPath = gs.topologyVersion;
}

export function update(e, gs, dt) {
  // Recompute if topology changed or dragon moved far
  if (e._topoOnPath !== gs.topologyVersion || needsRefresh(e, gs)) {
    e.path = computeShortestPath(gs.grid, [e.tileX,e.tileY], [gs.dragon.tileX, gs.dragon.tileY]);
    e._topoOnPath = gs.topologyVersion;
  }
  const speed = e.speedBase * e.speedMul;
  followPath(e, dt, gs.tileSize, speed);
  // If path ends without reaching dragon, fall back to Decision
  if (!e.path || e.path.length === 0) return 'decision';
  return null;
}

function needsRefresh(e, gs){
  const dx = Math.abs(gs.dragon.tileX - e._lastTargetX || 1e9);
  const dy = Math.abs(gs.dragon.tileY - e._lastTargetY || 1e9);
  const moved = (dx + dy) >= 2;
  e._lastTargetX = gs.dragon.tileX; e._lastTargetY = gs.dragon.tileY;
  return moved;
}
