// Simple flood fill from a start tile to check reachability.

export function floodFrom(grid, start) {
  const W = grid.W, H = grid.H;
  const q = [ [start.tileX, start.tileY] ];
  const seen = new Set([ key(start.tileX, start.tileY) ]);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [nx, ny] of neighbors4(grid, x, y)) {
      const k = key(nx, ny);
      if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen; // Set of "x,y"
}

export function isEntryConnectedToExit(grid, entry, exit) {
  const seen = floodFrom(grid, entry);
  return seen.has(key(exit.tileX, exit.tileY));
}

function neighbors4(grid, x, y) {
  const out = [];
  if (grid.isWalkable(x+1,y)) out.push([x+1,y]);
  if (grid.isWalkable(x-1,y)) out.push([x-1,y]);
  if (grid.isWalkable(x,y+1)) out.push([x,y+1]);
  if (grid.isWalkable(x,y-1)) out.push([x,y-1]);
  return out;
}

function key(x,y){ return `${x},${y}`; }
