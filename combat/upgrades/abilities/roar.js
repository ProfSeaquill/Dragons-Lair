// combat/upgrades/abilities/roar.js
// Handles Roar’s gameplay effect + visual FX spawn.

import * as state from '../../../state.js';


// How Roar FX should look / where it sits (visual tunables)
export const ROAR_FX_VISUAL = {
  sizeTiles: 2.0,    // how wide the sprite should be in tiles
  offsetYTiles: 0.8, // how far *above* the dragon in tiles
};

/**
 * Local helper: mark an enemy as "hit" so HP bar flashes.
 * (Mirrors combat.js's markHit behavior; duplicated to avoid circular imports.)
 */
function markVisualHit(e) {
  const now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  e.lastHitAt   = now;
  e.showHpUntil = now + 1000; // visible for 1s
}

/**
 * Apply Roar (stun + behavior buff) and spawn a roarWave FX above the dragon.
 * @param {GameState} gs - game state
 * @param {object} rs   - roar stats from state.getRoarStatsTuned(gs)
 *   Expected: rs.rangeTiles, rs.stunSec, rs.buffDur, rs.senseMult, rs.herdingMult, (optional) rs.fxDur
 */
export function applyRoar(gs = state.GameState, rs) {
  if (!gs || !rs) return;

  const a      = state.dragonAnchor(gs);      // tile-space dragon anchor
  const tsize  = state.GRID.tile || 32;

  // --- 1) Stun + temporary behavior buffs in a taxicab-radius around dragon
  const enemies = gs.enemies || [];
  for (const e of enemies) {
    if (!e) continue;
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    if (e.type === 'engineer' && e.tunneling) continue; // don’t affect burrowers

    const distMan = Math.abs(e.cx - a.cx) + Math.abs(e.cy - a.cy);
    if (distMan <= rs.rangeTiles) {
      e.stunLeft     = Math.max(e.stunLeft     || 0, rs.stunSec);
      e.roarBuffLeft = Math.max(e.roarBuffLeft || 0, rs.buffDur);
      e.senseBuff    = rs.senseMult;
      e.herdingBuff  = rs.herdingMult;
      markVisualHit(e);
    }
  }

  // --- 2) Spawn roarWave visual FX above the dragon’s head
  const effects = gs.effects || (gs.effects = []);

  const centerX = (a.cx + 0.5) * tsize;
  const centerY = (a.cy - 0.4) * tsize;   // a bit above the dragon sprite
  const fxDur   = rs.fxDur || 0.40;      // ~0.4s animation by default

  effects.push({
    type: 'roarWave',
    x: centerX,
    y: centerY,
    t: 0,
    dur: fxDur
  });
}

