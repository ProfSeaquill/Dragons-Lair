// e.g. combat/vents.js
export function applyFlameVents(gs, dt) {
  const vents = gs.flameVents || [];
  if (!vents.length) return;

  // Simple lookup: convert [{x,y}] into a Set of "x,y" strings
  const hot = new Set(vents.map(v => `${v.x},${v.y}`));

  const dps = 10; // or from tuning later
  const dmgPerSecond = dps;
  const dmg = dmgPerSecond * dt;

  for (const e of gs.enemies || []) {
    if (!e || e.dead) continue;
    const cx = e.cx | 0, cy = e.cy | 0;
    if (hot.has(`${cx},${cy}`)) {
      e.hp -= dmg;
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        // optional: gold/bones reward, reuse whatever logic you use for other DoT
      }
    }
  }
}
