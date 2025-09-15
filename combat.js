// combat.js (top)
import * as state from './state.js';
import { updateEnemyDistance, raycastOpenCellsFromExit } from './pathing.js';

// --- VISUAL: spawn a one-shot mouth fire effect
function spawnMouthFire(gs, dur = 0.6) {
  gs.effects = gs.effects || [];
  gs.effects.push({
    type: 'fireMouth',
    t: 0,          // elapsed seconds
    dur,           // how long the animation runs
    dead: false,   // cleanup flag
  });
}

/* =========================
 * Enemy templates & scaling
 * ========================= */

const CURVES = {
  hpBase:       { villager: 12,  squire: 16,  knight: 45,  hero: 65, engineer: 40, kingsguard: 90, boss: 300 },
  hpGrowth:     1.16,
  spdBase:      { villager: 1.6, squire: 1.7, knight: 2.5, hero: 1.8, engineer: 2.0, kingsguard: 2.2, boss: 2.0 },
  spdGrowth:    1.015,
  touchDmgBase: { villager: 8,   squire: 10,  knight: 14,  hero: 16, engineer: 20, kingsguard: 28, boss: 40 },
  touchDmgGrowth: 1.04,
};

const FLAGS = {
  kingsguardEvery: 5,        // miniboss cadence
  bossEvery: 10,             // Knight of the Round Table cadence
  engineerBombTimer: 10,     // seconds until detonation
  engineerTravelTime: 2.0,   // seconds "digging" underground before popping up
  engineerBombDmg: 35,       // damage to the dragon on bomb detonation
  spawnGap: 0.55,            // seconds between spawns
};

// Wave size curve
function waveCountFor(wave) {
  const base = 7, growth = 1.16;
  return Math.max(3, Math.round(base * Math.pow(growth, Math.max(0, wave - 1))));
}

function makeEnemy(type, wave) {
  const hp0  = CURVES.hpBase[type];
  const spd0 = CURVES.spdBase[type];
  const td0  = CURVES.touchDmgBase[type];

  const hp   = Math.round(hp0 * Math.pow(CURVES.hpGrowth, Math.max(0, wave - 1)));
  const spd  = spd0 * Math.pow(CURVES.spdGrowth, Math.max(0, wave - 1));
  const tDmg = Math.round(td0 * Math.pow(CURVES.touchDmgGrowth, Math.max(0, wave - 1)));

  const base = {
    type,
    name: type,
    hp,
    maxHp: hp,              // for health bars
    speed: spd,             // tiles/sec; main converts to px/sec
    contactDamage: tDmg,
    shield: false,          // used only for visuals on heroes
    miniboss: false,
    burnLeft: 0,
    burnDps: 0,
    updateByCombat: false,  // main handles movement via pathing interpolation
    lastHitAt: 0,
    showHpUntil: 0,
  };

  switch (type) {
    case 'villager':   return { ...base, name: 'Villager' };
    case 'squire':     return { ...base, name: 'Squire' };
    case 'knight':     return { ...base, name: 'Knight' };
    case 'hero':       return { ...base, name: 'Hero', shield: true };
    case 'engineer':   return { ...base, name: 'Engineer', tunneling: true, tunnelT: FLAGS.engineerTravelTime };
    case 'kingsguard': return { ...base, name: "King's Guard", miniboss: true };
    case 'boss':       return { ...base, name: 'Knight of the Round Table', miniboss: true };
    default:           return base;
  }
}

/* =========================
 * Wave composition (with thresholds)
 * ========================= */

export function previewWaveList(wave) {
  return planWaveList(wave).slice();
}

function planWaveList(wave) {
  const count = waveCountFor(wave);

  // Wave 1: all Villagers
  if (wave === 1) {
    return Array.from({ length: count }, () => 'villager');
  }

  const isBoss = (wave % FLAGS.bossEvery === 0);
  const isMini = !isBoss && (wave % FLAGS.kingsguardEvery === 0);

  const can = {
    villager:  true,
    squire:    wave >= 2,
    knight:    wave >= 6,
    hero:      wave >= 11,
    engineer:  wave >= 21,
    kingsguard:true,
    boss:      true,
  };

  const list = [];

  if (isBoss) {
    list.push('boss');
    const adds = Math.max(0, count - 1);
    for (let i = 0; i < adds; i++) {
      let type = 'squire';
      if (can.knight && i % 2 === 0) type = 'knight';
      if (can.hero && i % 5 === 0)   type = 'hero';
      list.push(type);
    }
    return list;
  }

  if (isMini) {
    list.push('kingsguard');
    const adds = Math.max(0, count - 1);
    for (let i = 0; i < adds; i++) {
      let type = 'villager';
      if (can.knight && i % 3 === 0)      type = 'knight';
      else if (can.squire && i % 2 === 0) type = 'squire';
      if (can.hero && i % 6 === 0)        type = 'hero';
      if (can.engineer && i % 8 === 0)    type = 'engineer';
      list.push(type);
    }
    return list;
  }

  // Normal waves
  for (let i = 0; i < count; i++) {
    let type = 'villager';
    if (can.engineer && i % 9 === 0)        type = 'engineer';
    else if (can.hero && i % 7 === 0)       type = 'hero';
    else if (can.knight && i % 3 === 0)     type = 'knight';
    else if (can.squire && i % 2 === 0)     type = 'squire';
    list.push(type);
  }
  return list;
}

/* =========================
 * Module runtime
 * ========================= */

const R = {
  spawning: false,
  queue: [],
  spawnTimer: 0,
  waveActive: false,
};

/* =========================
 * Public API
 * ========================= */

export function startWave(gs = state.GameState) {
  if (R.waveActive) return;
  R.queue = planWaveList(gs.wave);
  R.spawnTimer = 0;
  R.spawning = true;
  R.waveActive = true;
}

export const spawnNextWave = startWave;
export const spawnWave = startWave;
export { update as tick, update as step };

/* =========================
 * Update loop
 * ========================= */

export function update(gs = state.GameState, dt) {
  const enemies = gs.enemies || (gs.enemies = []);
  gs.effects = gs.effects || []; // bombs

  // 1) Spawning
  if (R.spawning && R.queue.length > 0) {
    R.spawnTimer -= dt;
    if (R.spawnTimer <= 0) {
      spawnOne(gs, R.queue.shift());
      R.spawnTimer = FLAGS.spawnGap;
    }
  }

  // 2) Enemy status (engineer tunneling, burn DoT, deaths, contact)
  const exitCx = state.EXIT.x, exitCy = state.EXIT.y;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    updateEnemyDistance(gs, e);

    // Engineers: tunneling -> pop near dragon -> plant bomb
    if (e.type === 'engineer' && e.tunneling) {
      e.tunnelT -= dt;
      if (e.tunnelT <= 0) {
        const spots = shuffle([
          { x: exitCx - 1, y: exitCy },
          { x: exitCx + 1, y: exitCy },
          { x: exitCx,     y: exitCy - 1 },
          { x: exitCx,     y: exitCy + 1 },
        ]).filter(p => state.inBounds(p.x, p.y));
        const spot = spots[0] || { x: exitCx, y: exitCy };
        e.cx = spot.x; e.cy = spot.y; e.dir = 'W';
        e.tunneling = false;

        // Plant bomb
        gs.effects.push({
          type: 'bomb',
          x: state.GRID.tile * (exitCx + 0.5),
          y: state.GRID.tile * (exitCy + 0.5),
          timer: FLAGS.engineerBombTimer,
          dmg: FLAGS.engineerBombDmg,
        });
      }
    }

    // Burn DoT (burn always ticks; shield only blocks direct fire)
    if (e.burnLeft > 0 && e.burnDps > 0) {
      const tick = Math.min(dt, e.burnLeft);
      e.burnLeft -= tick;
      e.hp -= e.burnDps * tick;
      markHit(e, e.burnDps * tick);
    }

    // Contact with dragon
    if (e.cx === exitCx && e.cy === exitCy) {
      gs.dragonHP = Math.max(0, gs.dragonHP - (e.contactDamage | 0));
      enemies.splice(i, 1);
      continue;
    }

    // Death -> rewards
    if (e.hp <= 0) {
      gs.gold  = (gs.gold  | 0) + 5;
      gs.bones = (gs.bones | 0) + 1;
      enemies.splice(i, 1);
      continue;
    }
  }

  // 3) Bomb timers
  for (let i = gs.effects.length - 1; i >= 0; i--) {
    const fx = gs.effects[i];
    if (fx.type !== 'bomb') continue;
    fx.timer -= dt;
    if (fx.timer <= 0) {
      gs.dragonHP = Math.max(0, gs.dragonHP - (fx.dmg | 0));
      gs.effects.splice(i, 1);
    }
  }

  // 4) Dragon breath (with shield rule)
  if (enemies.length > 0) {
    dragonBreathTick(gs, dt, state.getDragonStats(gs));
  }

  // 5) Wave completion
  if (R.waveActive && R.queue.length === 0 && enemies.length === 0) {
    R.waveActive = false;
    R.spawning = false;
    gs.wave = (gs.wave | 0) + 1;
  }
}

/* =========================
 * Spawning
 * ========================= */

function spawnOne(gs, type) {
  const e = makeEnemy(type, gs.wave | 0);
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';
  gs.enemies.push(e);
}

/* =========================
 * Dragon breath + hero shield rule
 * (Shield blocks FIRE damage, but BURN DoT still applies.)
 * ========================= */

let fireCooldown = 0;

function dragonBreathTick(gs, dt, ds) {
  fireCooldown -= dt;
  const firePeriod = 1 / Math.max(0.01, ds.fireRate);
  if (fireCooldown > 0) return;

  // right after you apply breath damage / start cooldown:
spawnMouthFire(gs, 0.6);   // ~0.6s looks good with 12 frames

  const enemies = gs.enemies;
  if (!enemies || enemies.length === 0) return;

  const dragon = {
    x: state.EXIT.x * state.GRID.tile + state.GRID.tile / 2,
    y: state.EXIT.y * state.GRID.tile + state.GRID.tile / 2,
  };

  // Choose target = nearest enemy (ignore tunneling engineers)
  let target = null, bestD2 = Infinity, targetPos = null;
  for (const e of enemies) {
    if (e.type === 'engineer' && e.tunneling) continue;
    const p = enemyPixelCenter(e);
    const dx = p.x - dragon.x, dy = p.y - dragon.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; target = e; targetPos = p; }
  }
  if (!target) return;

  // Aim unit vector
  const aim = { x: targetPos.x - dragon.x, y: targetPos.y - dragon.y };
  const len = Math.hypot(aim.x, aim.y) || 1;
  const ux = aim.x / len, uy = aim.y / len;

  const range = ds.breathRange;
  const halfWidth = ds.breathWidth * 0.5;
  const power = ds.breathPower;

  // Front-most hero (largest distFromEntry)
  let maxHeroDist = -1;
  for (const h of enemies) {
    if (h.type === 'hero' && isFinite(h.distFromEntry)) {
      if (h.distFromEntry > maxHeroDist) maxHeroDist = h.distFromEntry;
    }
  }
  const isShieldedByFrontHero = (e) =>
    (maxHeroDist >= 0) && isFinite(e.distFromEntry) && (e.distFromEntry <= maxHeroDist);

  // Apply beam effects to all units in cone
  for (const e of enemies) {
    if (e.type === 'engineer' && e.tunneling) continue;

    const p = enemyPixelCenter(e);
    const rx = p.x - dragon.x, ry = p.y - dragon.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > range) continue;

    const px = rx - ux * along;
    const py = ry - uy * along;
    const off = Math.hypot(px, py);
    if (off > halfWidth) continue;

    const shielded = isShieldedByFrontHero(e);

    // 1) Direct fire damage: ONLY if not shielded
    if (!shielded) {
      e.hp -= power;
      markHit(e, power);
    }

    // 2) Burn DoT applies to everyone (shield does not block burn)
    if (ds.burnDPS > 0 && ds.burnDuration > 0) {
      e.burnDps = ds.burnDPS;
      e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
      // mark hit so the HP bar shows even if only burn applied this frame
      markHit(e, 0.0001);
    }
  }

  fireCooldown = firePeriod;
}

/* =========================
 * Helpers
 * ========================= */

function enemyPixelCenter(e) {
  if (typeof e.x === 'number' && typeof e.y === 'number') return { x: e.x, y: e.y };
  return {
    x: e.cx * state.GRID.tile + state.GRID.tile / 2,
    y: e.cy * state.GRID.tile + state.GRID.tile / 2,
  };
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Healthbar visibility helper
function markHit(e, amount = 0) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  e.lastHitAt = now;
  e.showHpUntil = now + 1000; // visible for 1s since last damage tick
}
