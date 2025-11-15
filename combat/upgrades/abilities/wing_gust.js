// Dragons-Lair/combat/upgrades/abilities/wing_gust.js
import * as state from '../../../state.js';

/**
 * Spawn a wing-gust visual effect centered on the dragon.
 *
 * @param {object} gs           GameState
 * @param {function} acquireEffect  factory from combat.js: (kind, seedObj) => fx
 */
export function addWingGustEffect(gs, acquireEffect) {
  if (!gs || typeof acquireEffect !== 'function') return;

  const tsize = state.GRID.tile || 32;
  const cells = state.dragonCells(gs);
  if (!cells || !cells.length) return;

  // Dragon centroid in tile coords
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const cx = sx / cells.length;
  const cy = sy / cells.length;

  // Convert to pixel center
  const x = (cx + 0.5) * tsize;
  const y = (cy + 0.5) * tsize;

  const fx = acquireEffect('wingGust', {
    x,
    y,
    t: 0,
    dur: 0.4,      // seconds; tweak for slower/faster gust anim
  });

  (gs.effects || (gs.effects = [])).push(fx);
}

