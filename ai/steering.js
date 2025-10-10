export function tileId(x,y){ return (y<<16) | x; }

export function stepAlongDirection(e, dt, tileSize, speedTilesPerSec) {
  const pxPerSecX = e.dirX * speedTilesPerSec * tileSize;
  const pxPerSecY = e.dirY * speedTilesPerSec * tileSize;
  e.x += pxPerSecX * dt;
  e.y += pxPerSecY * dt;
  e.tileX = Math.floor(e.x / tileSize);
  e.tileY = Math.floor(e.y / tileSize);
}

export function setDirToward(e, fromX, fromY, toX, toY) {
  e.dirX = Math.sign(toX - fromX);
  e.dirY = (e.dirX !== 0) ? 0 : Math.sign(toY - fromY);
}

export function followPath(e, dt, tileSize, speed) {
  if (!e.path || e.path.length === 0) return;
  const [nx, ny] = e.path[0];
  if (e.tileX === nx && e.tileY === ny) { e.path.shift(); return; }
  setDirToward(e, e.tileX, e.tileY, nx, ny);
  stepAlongDirection(e, dt, tileSize, speed);
}
