// decision.js (scent-free)
import { CFG } from '../config.js';
import { visitedScore } from '../memory.js';
import { setDirToward } from '../steering.js';

export function enter(e, gs) {
  e.speedMul = 0; e.stateT = 0;
}

export function update(e, gs, dt) {
  e.stateT += dt;
  if (e.stateT < CFG.DECISION_THINK_TIME) return null;

  const cands = neighborDirs(gs.grid, e.tileX, e.tileY);
  let best = null, bestScore = +1e9;

  for (const dir of cands) {
    const nx = e.tileX + dir.dx, ny = e.tileY + dir.dy;
    const forwardPenalty = (dir.dx === -e.dirX && dir.dy === -e.dirY) ? CFG.FORWARD_BIAS : 0;
    const v = visitedScore(e, (ny<<16)|nx, gs.time.now);

    // Optional, very cheap tie-breaker: Manhattan to dragon OR to exit
    const tieBreak =
      Math.abs(nx - gs.dragon.tileX) + Math.abs(ny - gs.dragon.tileY);

    const score = forwardPenalty + v + 0.01 * tieBreak; // tiny weight
    if (score < bestScore) { bestScore = score; best = dir; }
  }

  if (best) {
    e.dirX = best.dx; e.dirY = best.dy;
    e.commitTilesLeft = CFG.COMMIT_TILES;
  }
  e.speedMul = 1;
  return 'search';
}

function neighborDirs(grid, x, y) {
  const out = [];
  if (grid.isWalkable(x+1,y)) out.push({dx:1, dy:0});
  if (grid.isWalkable(x-1,y)) out.push({dx:-1,dy:0});
  if (grid.isWalkable(x,y+1)) out.push({dx:0, dy:1});
  if (grid.isWalkable(x,y-1)) out.push({dx:0, dy:-1});
  return out;
}
