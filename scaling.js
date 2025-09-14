// scaling.js — wave sizes, HP/speed curves, and simple wave planning


/**
 * Central knobs for progression. These mirror the defaults used in combat.js.
 * If you change them here, consider importing these from combat.js (or vice versa)
 * so they stay in sync.
 */
export const PROGRESSION = {
  baseHP: 24,            // grunt HP at wave 1
  hpGrowth: 1.18,        // per-wave multiplicative growth
  baseSpeed: 2.4,        // tiles/sec at wave 1
  speedGrowth: 1.02,     // per-wave multipliclicative growth
  baseCount: 6,          // enemies at wave 1
  countGrowth: 1.18,     // per-wave multiplicative growth
  bossEvery: 5,          // boss wave cadence
  bossHpMult: 10,        // boss HP multiplier
  bossSpeedMult: 0.85,   // bosses move a bit slower
};

/** How many enemies in a given wave (before boss substitution). */
export function waveCountFor(wave) {
  const { baseCount, countGrowth } = PROGRESSION;
  return Math.max(1, Math.round(baseCount * Math.pow(countGrowth, Math.max(0, wave - 1))));
}

/** Whether the wave is a boss wave. */
export function isBossWave(wave) {
  const { bossEvery } = PROGRESSION;
  return bossEvery > 0 && (wave % bossEvery === 0);
}

/** Base HP for a normal grunt on this wave. */
export function hpForWave(wave) {
  const { baseHP, hpGrowth } = PROGRESSION;
  return Math.round(baseHP * Math.pow(hpGrowth, Math.max(0, wave - 1)));
}

/** Base tiles/sec speed for a normal grunt on this wave. */
export function speedForWave(wave) {
  const { baseSpeed, speedGrowth } = PROGRESSION;
  // Keep at least a small floor so very early waves don’t stall
  return Math.max(0.6, baseSpeed * Math.pow(speedGrowth, Math.max(0, wave - 1)));
}

/** Boss HP/speed for this wave (if applicable). */
export function bossHpForWave(wave) {
  return Math.round(hpForWave(wave) * PROGRESSION.bossHpMult);
}
export function bossSpeedForWave(wave) {
  return speedForWave(wave) * PROGRESSION.bossSpeedMult;
}

/**
 * Enemy templates — extend as you add special units.
 * type: string identifier you can branch on in combat or rendering if needed.
 */
export const ENEMY_TEMPLATES = {
  grunt: {
    name: 'Adventurer',
    // Derived each wave
  },
  boss: {
    name: 'King’s Guard',
    miniboss: true, // visually distinguished; “boss” flag is up to your logic
  },
};

/**
 * Build a concrete enemy record for spawning.
 * Returns a plain object with cx/cy/dir set by the spawner (caller), plus stats.
 */
export function makeEnemyForWave(type, wave) {
  switch (type) {
    case 'boss': {
      return {
        type,
        name: ENEMY_TEMPLATES.boss.name,
        miniboss: true,
        hp: bossHpForWave(wave),
        speed: bossSpeedForWave(wave),   // tiles/sec (main.js converts to px/sec)
        shield: false,
        burnLeft: 0,
        burnDps: 0,
      };
    }
    case 'grunt':
    default: {
      return {
        type: 'grunt',
        name: ENEMY_TEMPLATES.grunt.name,
        miniboss: false,
        hp: hpForWave(wave),
        speed: speedForWave(wave),
        shield: false,
        burnLeft: 0,
        burnDps: 0,
      };
    }
  }
}

/**
 * Wave plan helper — returns a simple plan you can feed to your spawner:
 * { wave, isBoss, count, list: [{type, hp, speed, miniboss}, ...] }
 *
 * Current policy:
 *  - On boss waves, the first spawn is a boss (one unit), followed by (count-1) grunts.
 *  - On normal waves, all spawns are grunts.
 */
export function planWave(wave) {
  const count = waveCountFor(wave);
  const boss = isBossWave(wave);
  const list = [];

  if (boss) {
    list.push(makeEnemyForWave('boss', wave));
    for (let i = 1; i < count; i++) {
      list.push(makeEnemyForWave('grunt', wave));
    }
  } else {
    for (let i = 0; i < count; i++) {
      list.push(makeEnemyForWave('grunt', wave));
    }
  }

  return { wave, isBoss: boss, count: list.length, list };
}

/**
 * Optional lightweight text for UI preview panel.
 * Use in ui.js like: previewEl.textContent = wavePreviewString(GameState.wave)
 */
export function wavePreviewString(wave) {
  const plan = planWave(wave);
  const bossTag = plan.isBoss ? ' — Boss!' : '';
  const avgHp = Math.round(
    plan.list.reduce((s, e) => s + e.hp, 0) / Math.max(1, plan.list.length)
  );
  const avgSpd = (
    plan.list.reduce((s, e) => s + e.speed, 0) / Math.max(1, plan.list.length)
  ).toFixed(2);

  return `Wave ${wave}${bossTag}
Enemies: ${plan.count}
Avg HP: ${avgHp}
Avg Speed (tiles/s): ${avgSpd}`;
}
