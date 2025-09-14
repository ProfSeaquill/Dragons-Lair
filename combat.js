// combat.js — wave spawner + basic combat loop for maze-walk pathing

import * as state from './state.js';
import { updateEnemyDistance } from './pathing.js';

// ============================
// Tunables / simple scaling
// ============================

const SCALING = {
  baseHP: 24,             // grunt HP at wave 1
  hpGrowth: 1.18,         // per-wave multiplicative growth
  baseSpeed: 2.4,         // tiles/sec at wave 1
  speedGrowth: 1.02,      // per-wave multiplicative growth
  baseCount: 6,           // enemies at wave 1
  countGrowth: 1.18,      // per-wave multiplicative growth
  spawnGap: 0.6,          // seconds between spawns
  bossEvery: 5,           // boss wave period
  bossHpMult: 10,         // boss HP multiplier
  bossSpeedMult: 0.85,    // bosses move a bit slower
  goldPerKill: 5,
  bonesPerKill: 1,
  contactDamage: 10,      // damage to dragon when enemy reaches state.EXIT cell
};

// ============================
// Module-local runtime state
// ============================

const R = {
  spawning: false,
  toSpawn: 0,
  spawnTimer: 0,
  waveActive: false,
};

// ============================
// Public API
// ============================

export function startWave(gs = state.GameState) {
  if (R.waveActive) return;
  const n = Math.round(SCALING.baseCount * Math.pow(SCALING.countGrowth, (gs.wave - 1)));
  R.toSpawn = Math.max(1, n);
  R.spawnTimer = 0;
  R.spawning = true;
  R.waveActive = true;
}

export const spawnNextWave = startWave; // alias for compatibility
export const spawnWave = startWave;     // alias for compatibility

export function update(gs = state.GameState, dt) {
  const enemies = gs.enemies || (gs.enemies = []);

  // 1) Spawn logic
  if (R.spawning && R.toSpawn > 0) {
    R.spawnTimer -= dt;
    if (R.spawnTimer <= 0) {
      spawnOne(gs);
      R.toSpawn--;
      R.spawnTimer = SCALING.spawnGap;
    }
  }

  // 2) Enemy bookkeeping (reaching dragon, burning, deaths)
  const ds = state.getDragonStats(gs);
  const exitCx = state.EXIT.x, exitCy = state.EXIT.y;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    // Keep distance cache fresh (used by shielding/ordering if you add it)
    updateEnemyDistance(gs, e);

    // Resolve burn DoT
    if (e.burnLeft > 0 && e.burnDps > 0) {
      const tick = Math.min(dt, e.burnLeft);
      e.burnLeft -= tick;
      e.hp -= e.burnDps * tick;
    }

    // Check contact with dragon (enemy reaches the state.EXIT cell)
    if (e.cx === exitCx && e.cy === exitCy) {
      gs.dragonHP = Math.max(0, gs.dragonHP - SCALING.contactDamage);
      // remove this enemy
      enemies.splice(i, 1);
      continue;
    }

    // Death cleanup
    if (e.hp <= 0) {
      gs.gold = (gs.gold | 0) + SCALING.goldPerKill;
      gs.bones = (gs.bones | 0) + SCALING.bonesPerKill;
      enemies.splice(i, 1);
      continue;
    }
  }

  // 3) Dragon breath (auto-aim at nearest enemy)
  if (enemies.length > 0) {
    dragonBreathTick(gs, dt, ds);
  }

  // 4) Wave completion -> advance wave (and maybe auto-start via main.js)
  if (R.waveActive && R.toSpawn <= 0 && enemies.length === 0) {
    R.waveActive = false;
    R.spawning = false;
    gs.wave = (gs.wave | 0) + 1;
  }
}

// ============================
// Spawning
// ============================

function spawnOne(gs) {
  const wave = gs.wave | 0;
  const isBoss = (wave % SCALING.bossEvery === 0) && (R.toSpawn === Math.max(1, Math.round(SCALING.baseCount * Math.pow(SCALING.countGrowth, (wave - 1)))));

  const hpBase = SCALING.baseHP * Math.pow(SCALING.hpGrowth, (wave - 1));
  const speedTiles = SCALING.baseSpeed * Math.pow(SCALING.speedGrowth, (wave - 1));

  const e = {
    // state.GRID position & facing (spawn at state.ENTRY, try heading east by default)
    cx: state.ENTRY.x,
    cy: state.ENTRY.y,
    dir: 'E',

    // Movement speed (main.js will use pxPerSec or speed in tiles/sec)
    speed: (isBoss ? speedTiles * SCALING.bossSpeedMult : speedTiles),
    pxPerSec: undefined,   // let main derive from `speed`

    // Stats
    hp: Math.round(isBoss ? hpBase * SCALING.bossHpMult : hpBase),
    shield: false,
    miniboss: isBoss,

    // Status
    burnLeft: 0,
    burnDps: 0,

    // Integration flags
    updateByCombat: false, // let main.js move via pathing interpolation
  };

  gs.enemies.push(e);
}

// ============================
// Dragon breath (auto target)
// ============================

let fireCooldown = 0;

function dragonBreathTick(gs, dt, ds) {
  fireCooldown -= dt;
  const firePeriod = 1 / Math.max(0.01, ds.fireRate);
  if (fireCooldown > 0) return;

  const enemies = gs.enemies;
  if (!enemies || enemies.length === 0) return;

  const dragon = {
    x: state.EXIT.x * state.GRID.tile + state.GRID.tile / 2,
    y: state.EXIT.y * state.GRID.tile + state.GRID.tile / 2,
  };

  // Choose target = nearest enemy by pixel distance to dragon
  let target = null, bestD2 = Infinity, targetPos = null;
  for (const e of enemies) {
    const p = enemyPixelCenter(e);
    const dx = p.x - dragon.x, dy = p.y - dragon.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; target = e; targetPos = p; }
  }
  if (!target) return;

  // Aim vector
  const aim = { x: targetPos.x - dragon.x, y: targetPos.y - dragon.y };
  const len = Math.hypot(aim.x, aim.y) || 1;
  const ux = aim.x / len, uy = aim.y / len;

  // Cone parameters
  const range = ds.breathRange;
  const halfWidth = ds.breathWidth * 0.5;
  const power = ds.breathPower;

  // Apply damage to enemies within the cone
  for (const e of enemies) {
    const p = enemyPixelCenter(e);
    const rx = p.x - dragon.x, ry = p.y - dragon.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > range) continue;

    // distance to beam centerline
    const px = rx - ux * along;
    const py = ry - uy * along;
    const off = Math.hypot(px, py);

    if (off <= halfWidth) {
      // Shield rule could go here; for now, straight damage
      e.hp -= power;

      // Optional burn application
      if (ds.burnDPS > 0 && ds.burnDuration > 0) {
        e.burnDps = ds.burnDPS;
        e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
      }
    }
  }

  fireCooldown = firePeriod;
}

// ============================
// Helpers
// ============================

function enemyPixelCenter(e) {
  if (typeof e.x === 'number' && typeof e.y === 'number') {
    return { x: e.x, y: e.y };
  }
  return {
    x: e.cx * state.GRID.tile + state.GRID.tile / 2,
    y: e.cy * state.GRID.tile + state.GRID.tile / 2,
  };
}
