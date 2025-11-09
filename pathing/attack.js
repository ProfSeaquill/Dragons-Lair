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
    // Default (cleared) each frame; set when we decide to attack
e.isAttacking = false;
e.pausedForAttack = false;
e._suppressSep = false;


    // Zone => freeze handled by combat; here we only drive the cooldown and damage.
    let canAttack = false;

    if (inZone) {
  // In the zone: this *is* the contact band. Lock + face lair + suppress offsets.
  e.isAttacking = true;
  e.pausedForAttack = true;
  e.commitDir = null;
  e.commitTilesLeft = 0;
  e.dir = 'W';
  e._suppressSep = true;
  canAttack = true;
} else {
  // Fallback = original “adjacent + open edge” test
  let adjAndOpen = false;
  DRAGON_CONTACT: for (const dc of state.dragonCells(gs)) {
    const dx = dc.x - cx, dy = dc.y - cy;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
    const side = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
    if (state.isOpen(gs, cx, cy, side)) { adjAndOpen = true; break DRAGON_CONTACT; }
  }
  canAttack = adjAndOpen;
  e.isAttacking = !!adjAndOpen;
  e.pausedForAttack = !!adjAndOpen;
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
