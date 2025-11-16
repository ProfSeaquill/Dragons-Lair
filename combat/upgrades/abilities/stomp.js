// combat/upgrades/abilities/stomp.js
import * as state from '../../../state.js';

// Stomp: low dmg + slow in a big radius + ground ripple FX.
// - gs: GameState
// - ss: stomp stats (from getStompStatsTuned(gs))
// - acquireEffect: function(kind, seedObj) from combat.js
// - markHit: function(enemy, amount) from combat.js
export function applyStomp(gs, ss, acquireEffect, markHit) {
  const a = state.dragonAnchor(gs);         // { cx, cy } anchor by dragon
  const enemies = gs.enemies || [];

  // --- Gameplay: damage + slow ---
  for (const e of enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const distMan = Math.abs(e.cx - a.cx) + Math.abs(e.cy - a.cy);
    if (distMan <= ss.rangeTiles) {
      e.hp -= ss.dmg;
      if (typeof markHit === 'function') {
        markHit(e, ss.dmg);
      }
      e.slowLeft = Math.max(e.slowLeft || 0, ss.slowSec);
      e.slowMult = Math.min(e.slowMult || 1, ss.slowMult); // strongest slow wins
    }
  }

  // --- Visual: stomp ground ripple, centered at dragon anchor in pixel space ---
  if (typeof acquireEffect !== 'function') return;

  const tsize = state.GRID?.tile || 32;

  const px = (a.cx + 0.5) * tsize;
  const py = (a.cy + 0.5) * tsize;

  const arr = gs.effects || (gs.effects = []);

  arr.push(
    acquireEffect('stompRipple', {
      x: px,
      y: py,
      dur: 2.0,  // How long the ring travels (seconds). Lower = faster
      maxRadius: ss.rangeTiles * tsize * 10.0, // How far the wave front gets; a bit beyond the slow radius looks nice
      strengthPx: tsize * 3.00,  // Maximum pixel offset at the active ring 
      bandWidthPx: tsize * 3.00,  // Thickness of the “active” band (in pixels)
    })
  );
}

