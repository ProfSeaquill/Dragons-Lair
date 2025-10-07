import { CFG } from './config.js';

export function isJunction(grid, x, y) {
  // 4-neighbors count of walkables (excluding the tile we came from is handled in scoring)
  let n = 0;
  if (grid.isWalkable(x+1,y)) n++;
  if (grid.isWalkable(x-1,y)) n++;
  if (grid.isWalkable(x,y+1)) n++;
  if (grid.isWalkable(x,y-1)) n++;
  // Junction or dead-end both trigger Decision, but dead-end enforces U-turn
  return n !== 2; // corridor has exactly 2; else we decide
}

export function canSeeDragon(grid, e, dragon) {
  // Cheap Bresenham LOS with cap
  const dx = dragon.tileX - e.tileX, dy = dragon.tileY - e.tileY;
  if (Math.abs(dx) + Math.abs(dy) > CFG.LOS_MAX_TILES) return false;
  // Raycast — stop on wall
  let x = e.tileX, y = e.tileY;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i=0;i<steps;i++) {
    x += Math.sign(dx);
    y += Math.sign(dy);
    if (!grid.isWalkable(x,y)) return false;
    if (x === dragon.tileX && y === dragon.tileY) return true;
  }
  return false;
}

export function dragonScentHeuristic(grid, node, dragon) {
  const d = Math.abs(node.x - dragon.tileX) + Math.abs(node.y - dragon.tileY);
  return -CFG.DRAGON_SCENT * Math.max(0, (CFG.SCENT_RADIUS - d)); // closer to dragon => better (more negative)
}
