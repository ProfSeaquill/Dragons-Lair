// combat.js — multi-enemy roster + bosses + engineer bombs for edge-walls pathing

import * as state from './state.js';
import { updateEnemyDistance } from './pathing.js';

/* =========================
 * Enemy templates & scaling
 * ========================= */
const CURVES = {
  hpBase:       { villager: 10,  squire: 14,  knight: 30,  hero: 60, engineer: 40, kingsguard: 90, boss: 320 },
  hpGrowth:     1.16,
  spdBase:      { villager: 1.6, squire: 1.7, knight: 2.7, hero: 1.8, engineer: 2.4, kingsguard: 2.5, boss: 2.0 },
  spdGrowth:    1.015,
  touchDmgBase: { villager: 8,   squire: 10,  knight: 14,  hero: 16, engineer: 0, kingsguard: 28, boss: 40 },
  touchDmgGrowth: 1.04,
};

const FLAGS = {
  kingsguardEvery: 5,
  bossEvery: 10,
  engineerBombTimer: 10,
  engineerTravelTime: 2.0,
  engineerBombDmg: 35,
  spawnGap: 0.55,
};

// Wave size curve
function waveCountFor(wave) {
  const base = 7, growth = 1.16;
  return Math.max(3, Math.round(base * Math.pow(growth, Math.max(0, wave - 1))));
}

function markHit(e, amount = 0) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  e.lastHitAt = now;
  e.showHpUntil = now + 1000; // visible for 1s since last damage tick
}

// Build a concrete enemy entry (stats only; spawn fills position)
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
    speed: spd,
    contactDamage: tDmg,
    shield: false,
    miniboss: false,
    burnLeft: 0,
    burnDps: 0,
    updateByCombat: false, // main moves them via pathing
  };

  switch (type) {
    case 'villager':   return { ...base, name: 'Villager' };
    case 'squire':     return { ...base, name: 'Squire' };
    case 'knight':     return { ...base, name: 'Knight' };
    case 'hero':       return { ...base, name: 'Hero', shield: true };
    case 'engineer':   return { ...base, name: 'Engineer', tunneling: true, tunnelT: FLAGS.engineerTravelTime };
    case 'kingsguard': return { ...base, name: 'King’s Guard', miniboss: true };
    case 'boss':       return { ...base, name: 'Knight of the Round Table', miniboss: true };
    default:           return base;
  }
}

/* =========================
 * Wave composition (with thresholds you requested)
 * ========================= */
export function previewWaveList(wave) {
  return planWaveList(wave).slice();
}

// Rules:
// - Wave 1: all Villagers
// - Boss every 10: 1 boss + tough adds (no Heroes <11, no Engineers <21)
// - Miniboss every 5 (not 10): 1 kingsguard + mixed adds (same thresholds)
// - Normal: deterministic mix, thresholds respected
function planWaveList(wave) {
  const count = waveCountFor(wave);

  if (wave === 1) return Array.from({ length: count }, () => 'villager');

  const isBoss = (wave % FLAGS.bossEvery === 0);
  const isMini = !isBoss && (wave % FLAGS.kingsguardEvery === 0);

  const can = {
    villager:   true,
    squire:     wave >= 2,
    knight:     wave >= 6,
    hero:       wave >= 11,
    engineer:   wave >= 21,
    kingsguard: true,
    boss:       true,
  };

  const list = [];

  if (isBoss) {
    list.push('boss');
    const adds = Math.max(0, count - 1);
    for (let i = 0; i < adds; i++) {
      let type = 'squire';
      if (can.knight && i % 2 === 0) type = 'knight';
      if (can.hero   && i % 5 === 0) type = 'hero';
      list.push(type);
    }
    return list;
  }

  if (isMini) {
    list.push('kingsguard');
    const adds = Math.max(0, count - 1);
    for (let i = 0; i < adds; i++) {
      let type = 'villager';
      if (can.knight && i % 3 === 0) type = 'knight';
      else if (can.squire && i % 2 === 0) type = 'squire';
      if (can.hero && i % 6 === 0) type = 'hero';
      if (can.engineer && i % 8 === 0) type = 'engineer';
      list.push(type);
    }
    return list;
  }

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
export { update as tick, update as step }; // compat aliases

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

        gs.effects.push({
          type: 'bomb',
          x: state.GRID.tile * (exitCx + 0.5),
          y: state.GRID.tile * (exitCy + 0.5),
          timer: FLAGS.engineerBombTimer,
          dmg: FLAGS.engineerBombDmg,
        });
      }
    }

    // Burn DoT
if (e.burnLeft > 0 && e.burnDps > 0) {
  const tick = Math.min(dt, e.burnLeft);
  e.burnLeft -= tick;
  e.hp -= e.burnDps * tick;
  markHit(e, e.burnDps * tick);if

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

  // 4) Dragon breath (with corrected hero shield logic)
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
  e.maxHp = e.hp;
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';
  gs.enemies.push(e);
}

/* =========================
 * Dragon breath + hero shields
 * ========================= */
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

  // Target nearest (ignore tunneling engineers)
  let target = null, bestD2 = Infinity, targetPos = null;
  for (const e of enemies) {
    if (e.type === 'engineer' && e.tunneling) continue;
    const p = enemyPixelCenter(e);
    const dx = p.x - dragon.x, dy = p.y - dragon.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; target = e; targetPos = p; }
  }
  if (!target) return;

  const aim = { x: targetPos.x - dragon.x, y: targetPos.y - dragon.y };
  const len = Math.hypot(aim.x, aim.y) || 1;
  const ux = aim.x / len, uy = aim.y / len;

  const range = ds.breathRange;
  const halfWidth = ds.breathWidth * 0.5;
  const power = ds.breathPower;

  // Front-most hero (largest distance from ENTRY)
  let maxHeroDist = -1;
  for (const h of enemies) {
    if (h.type === 'hero' && isFinite(h.distFromEntry)) {
      if (h.distFromEntry > maxHeroDist) maxHeroDist = h.distFromEntry;
    }
  }

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

    // Units strictly behind the front-most hero (closer to ENTRY) are shielded
    const shielded = (maxHeroDist >= 0) && isFinite(e.distFromEntry) && (e.distFromEntry < maxHeroDist);
    if (!shielded) {
  e.hp -= power;
  markHit(e, power);
}

    // Burn always applies
    if (ds.burnDPS > 0 && ds.burnDuration > 0) {
      e.burnDps = ds.burnDPS;
      e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
    }
  }

  // Kick off the visual breath animation
gs.dragonFX = gs.dragonFX || { attacking:false, t:0, dur:0.5 };
gs.dragonFX.attacking = true;
gs.dragonFX.t = 0;

// Important: next-shot timer starts AFTER the anim finishes
// Total wait = animation duration + normal fire period
const animDur = gs.dragonFX.dur || 0.5;
fireCooldown = animDur + firePeriod;
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
