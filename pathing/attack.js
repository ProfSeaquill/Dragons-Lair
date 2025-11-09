// pathing/attack.js
import * as state from '../state.js';
import { isInAttackZone } from '../grid/attackzone.js';

function _markHit(e, amount = 0) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  e.lastHitAt = now;
  e.showHpUntil = now + 1000;
}

/** Centralized per-frame contact attacks. */
export function updateAttacks(gs, dt) {
  const enemies = gs.enemies || [];
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e) continue;
    if (e.hp <= 0) continue;
    if (e.type === 'engineer' && e.tunneling) continue;

    const cx = e.cx|0, cy = e.cy|0;
    const inZone = isInAttackZone(gs, cx, cy);

    // Zone => freeze handled by combat; here we only drive the cooldown and damage.
    let canAttack = false;

    if (inZone) {
      canAttack = true;            // unconditional inside the zone
      e.isAttacking = true;
    } else {
      // Fallback = your original “adjacent + shared edge is open” test
      let adjAndOpen = false;
      DRAGON_CONTACT: for (const dc of state.dragonCells(gs)) {
        const dx = dc.x - cx, dy = dc.y - cy;
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        const side = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
        if (state.isOpen(gs, cx, cy, side)) { adjAndOpen = true; break DRAGON_CONTACT; }
      }
      canAttack = adjAndOpen;
      e.isAttacking = !!adjAndOpen;
    }

    if (!canAttack) continue;

    e._atkCD = (e._atkCD ?? 0) - dt;
    if (e._atkCD <= 0) {
      const rate = Math.max(0.05, e.rate || 0.5);
      const dmg  = Math.max(1, e.damage | 0);
      gs.dragonHP = Math.max(0, (gs.dragonHP | 0) - dmg);
      e._atkCD = 1 / rate;
      _markHit(e, dmg);
    }
  }
}
