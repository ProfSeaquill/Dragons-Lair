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

let fireCooldown = 0;

function dragonBreathTick(gs, dt, ds) {
  fireCooldown -= dt;
  const firePeriod = 1 / Math.max(0.01, ds.fireRate);
  if (fireCooldown > 0) return;

  // Build a corridor path starting at the dragon (EXIT) walking “downhill” toward ENTRY.
  const maxTiles = Math.max(1, Math.round(ds.breathRange / state.GRID.tile));
  const path = raycastOpenCellsFromExit(gs, maxTiles);
  if (!path || path.length === 0) { fireCooldown = firePeriod; return; }

  // Visuals: add a traveling flame wave along that corridor (render.js will draw it).
  (gs.effects || (gs.effects = [])).push({
    type: 'flameWave',
    path,                // [{ x, y, from:'N'|'E'|'S'|'W' }, ...]
    headIdx: 0,
    t: 0,
    dur: 0.7,            // linger time for the glow
    tilesPerSec: 16,     // how fast the wave head advances
    widthPx: state.GRID.tile * 0.85,
  });

  // Prepare a fast lookup of the corridor tiles we hit this tick.
  const hit = new Set(path.map(seg => state.tileKey(seg.x, seg.y)));

  // Front-most hero (largest distance-from-entry) provides the shield line.
  let maxHeroDist = -1;
  for (const h of gs.enemies) {
    if (h.type === 'hero' && isFinite(h.distFromEntry)) {
      if (h.distFromEntry > maxHeroDist) maxHeroDist = h.distFromEntry;
    }
  }

  // Helper: is this enemy behind (or at) the front-most hero line?
  const shieldedByHero = (e) =>
    (maxHeroDist >= 0) &&
    isFinite(e.distFromEntry) &&
    (e.distFromEntry < maxHeroDist); // strictly behind the front hero (closer to ENTRY)

  // Apply damage only to units that are on the corridor tiles (no wall clipping).
  for (const e of gs.enemies) {
    if (e.type === 'engineer' && e.tunneling) continue; // ignore underground
    if (!hit.has(state.tileKey(e.cx, e.cy))) continue;  // not in corridor this tick

    const shielded = shieldedByHero(e);

    // 1) Direct fire is blocked by shield line.
    if (!shielded) {
      e.hp -= ds.breathPower;
      markHit(e, ds.breathPower);
    }

    // 2) Burn always applies, even to shielded units.
    if (ds.burnDPS > 0 && ds.burnDuration > 0) {
      e.burnDps = ds.burnDPS;
      e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
      // ensure HP bar shows even if only burn was applied this frame
      markHit(e, 0.0001);
    }
  }

  // Kick the mouth FX so the sprite animates while breathing
  gs.dragonFX = { attacking: true, t: 0, dur: 0.25 };

  fireCooldown = firePeriod;
}

/* =========================
 * Helpers
 * ========================= */

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
