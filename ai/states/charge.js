import { CFG } from '../config.js';
import { followPath } from '../steering.js';
import { computeShortestPath } from '../topology.js';
import * as state from '../../state.js';

export function enter(e, gs) {
  // make sure pixel-space coords exist for steering helpers
  if (typeof e.x !== 'number' || typeof e.y !== 'number') {
    const t = gs.tileSize || state.GRID.tile;
    const cx = Number.isInteger(e.cx) ? e.cx : (e.tileX | 0);
    const cy = Number.isInteger(e.cy) ? e.cy : (e.tileY | 0);
    e.x = (cx + 0.5) * t;
    e.y = (cy + 0.5) * t;
    e.tileX = cx;
    e.tileY = cy;
  }

  e.speedMul = CFG.CHARGE_MUL;

  // target = dragon footprint (no gs.dragon object in your state)
  const sx = Number.isInteger(e.cx) ? e.cx : (e.tileX | 0);
  const sy = Number.isInteger(e.cy) ? e.cy : (e.tileY | 0);

  const pathObjs = computeShortestPath(gs, sx, sy, state.dragonCells(gs));
e.path = Array.isArray(pathObjs) ? pathObjs : null;


  e._topoOnPath = (gs.topologyVersion | 0);
}

export function update(e, gs, dt) {
  // Recompute when topology changes
  if (e._topoOnPath !== (gs.topologyVersion | 0)) {
    const sx = Number.isInteger(e.cx) ? e.cx : (e.tileX | 0);
    const sy = Number.isInteger(e.cy) ? e.cy : (e.tileY | 0);
    const pathObjs = computeShortestPath(gs, sx, sy, state.dragonCells(gs));
    e.path = Array.isArray(pathObjs) ? pathObjs.map(p => [p.x, p.y]) : null;
    e._topoOnPath = (gs.topologyVersion | 0);
  }

  const speed = e.speedBase * e.speedMul;
  followPath(e, dt, gs.tileSize || state.GRID.tile, speed);

  // If path ran out, fall back to a decision point
  if (!e.path || e.path.length === 0) return 'decision';
  return null;
}
