// Optional: only if you relied on updateEnemyDistance for HUD/logic.
// Default impl uses Manhattan distance; swap for path length if you want.

export function updateEnemyDistance(e, gs) {
  if (!gs.exit) return;
  const dx = Math.abs(e.tileX - gs.exit.tileX);
  const dy = Math.abs(e.tileY - gs.exit.tileY);
  e.distToExit = dx + dy;
}
