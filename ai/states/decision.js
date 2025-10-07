import { CFG } from '../config.js';
import { visitedScore } from '../memory.js';
import { dragonScentHeuristic } from '../perception.js';
import { setDirToward } from '../steering.js';

export function enter(e, gs) {
  e.speedMul = 0;        // stop while thinking
  e.stateT = 0;
  e._decisionChosen = null;
}

export function update(e, gs, dt) {
  e.stateT += dt;
  if (e.stateT < CFG.DECISION_THINK_TIME) return null;

  // Score candidate branches
  const cands = neighborDirs(gs.grid, e.tileX, e.tileY);
  let best = null, bestScore = +1e9;

  for (const dir of cands) {
    // discourage immediate U-turns
    const forwardPenalty = (dir.dx === -e.dirX && dir.dy === -e.dirY) ? CFG.FORWARD_BIAS : 0;

    const nx = e.tileX + dir.dx, ny = e.tileY + dir.dy;
    const tileId = (ny<<16) | nx;

    const v = visitedScore(e, tileId, gs.time.now);
    const scent = dragonScentHeuristic(gs.grid, {x:nx,y:ny}, gs.dragon);

    const score = forwardPenalty + v + scent;
    if (score < bestScore) { bestScore = score; best = dir; }
  }

  // Commit
  if (best) {
    e.dirX = best.dx; e.dirY = best.dy;
    e.commitTilesLeft = CFG.COMMIT_TILES;
  }
  e.speedMul = 1; // resume movement
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
