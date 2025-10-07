// Thin wrappers so your UI code can keep calling the same names.

export function toggleEdge(grid, edge) {
  // delegate to your grid’s internal API
  // expected: edge = { x, y, dir: 'h'|'v' } or whatever your format is
  grid.toggleEdge(edge);
}

export function edgeHasWall(grid, edge) {
  return grid.edgeHasWall(edge);
}
