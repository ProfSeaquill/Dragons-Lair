// combat.js — wave creation, dragon breath, enemy AI, rewards (grant-on-kill)

import { getDragonStats } from './state.js';
import { waveComposition, enemyStats, rewardsFor } from './scaling.js';

// -------- Enemy factory --------
function makeEnemiesForWave(wave) {
  const comp = waveComposition(wave);
  const list = Array.isArray(comp) ? comp : Object.entries(comp).map(([type, count]) => ({ type, count }));
  const out = [];
  for (const { type, count } of list) {
    for (let i = 0; i < count; i++) out.push(createEnemy(type, wave, i));
  }
  return out;
}

function createEnemy(type, wave, spawnIndex = 0) {
  const t = String(type).toLowerCase();
  const s = enemyStats(t, wave);
  return {
    id: Math.random().toString(36).slice(2),
    type: t,
    hp: s.hp,
    maxHP: s.hp,
    speed: s.speed,            // tiles/sec
    pathIndex: 0,
    progress: 0,
    spawnDelay: spawnIndex * 0.2, // seconds stagger
    shieldUp: t === 'hero',
    safeDodgeLeft: t === 'kingsguard' ? 2 : 0,
    burrowLeft: t === 'engineer' ? 3 : 0,
    burrowCooldown: 0,         // seconds
    burning: { dps: 0, t: 0 },
    plantingBomb: false,
    bombTimer: 0,              // seconds
    __rewarded: false,         // internal: reward granted flag
  };
}

// -------- Wave API --------
export function makeWave(gs) {
  gs.enemies = makeEnemiesForWave(gs.wave);
  gs._breathAcc = 0;
}

export function tickCombat(dt, gs) {
  if (!gs?.enemies || !gs?.path?.length) return true;

  dragonBreathTick(dt, gs);

  for (const e of gs.enemies) {
    if (e.hp <= 0) continue;

    // spawn gating
    if (e.spawnDelay > 0) { e.spawnDelay = Math.max(0, e.spawnDelay - dt); continue; }

    engineerLogic(e, gs);
    kingsguardDodgeMaybe(e);
    advanceAlongPath(e, gs, dt);
    tickBurn(e, dt, gs);
    attackDragonIfAtExit(e, gs, dt);
  }

  // Remove dead (after rewards already granted)
  gs.enemies = gs.enemies.filter(e => e.hp > 0 && gs.dragon.hp > 0);

  const anyPendingSpawn = gs.enemies.some(e => e.spawnDelay > 0);
  const allDead = gs.enemies.length === 0;
  const dragonDead = gs.dragon?.hp <= 0;

  return dragonDead || (allDead && !anyPendingSpawn);
}

// -------- Internals --------
function grantOnKillOnce(gs, e) {
  if (e.__rewarded) return;
  const r = rewardsFor(e.type, gs.wave);
  gs.gold = (gs.gold | 0) + r.gold;
  gs.bones = (gs.bones | 0) + r.bones;
  e.__rewarded = true;
}

function applyBurn(e, dps, duration) {
  if (dps <= 0 || duration <= 0) return;
  e.burning.dps = Math.max(e.burning.dps, dps);
  e.burning.t = Math.max(e.burning.t, duration);
}

function tickBurn(e, dt, gs) {
  if (e.burning.t > 0 && e.hp > 0) {
    e.hp -= e.burning.dps * dt;
    e.burning.t -= dt;
    if (e.hp <= 0) grantOnKillOnce(gs, e);
  }
}

function kingsguardDodgeMaybe(e) {
  if (e.type !== 'kingsguard' || e.safeDodgeLeft <= 0) return;
  if (Math.random() < 0.02) { e.progress = 0; e.safeDodgeLeft--; }
}

function engineerLogic(e, gs) {
  if (e.type !== 'engineer' || e.burrowLeft <= 0) return;
  if (e.burrowCooldown > 0) { e.burrowCooldown = Math.max(0, e.burrowCooldown - 1/60); return; }
  if (Math.random() < 0.01) {
    const skip = 2 + Math.floor(Math.random() * 2); // 2–3
    e.pathIndex = Math.min(e.pathIndex + Math.min(skip, gs.path.length - 1 - e.pathIndex), gs.path.length - 1);
    e.burrowLeft--; e.burrowCooldown = 1.0; e.progress = 0;
  }
}

function advanceAlongPath(e, gs, dt) {
  if (gs.path.length === 0 || e.hp <= 0) return;
// Stop on the tile ADJACENT to the dragon (index = length - 2).
  const lastFightIdx = Math.max(0, gs.path.length - 2);
  if (e.pathIndex >= lastFightIdx) return;

  const tilesToAdvance = e.speed * dt + e.progress;
  const whole = Math.floor(tilesToAdvance);
  e.progress = tilesToAdvance - whole;

  e.pathIndex = Math.min(e.pathIndex + whole, lastFightIdx);
}


function attackDragonIfAtExit(e, gs, dt) {
  if (e.hp <= 0) return;
  if (!Array.isArray(gs.path) || gs.path.length === 0) return;

  // Units stop and attack from the tile ADJACENT to the dragon
  const lastFightIdx = Math.max(0, gs.path.length - 2);
  if (e.pathIndex < lastFightIdx) return; // not yet adjacent to dragon

  // Engineer: plant a bomb with a short fuse; explodes and kills the engineer
  if (e.type === 'engineer') {
    if (!e.plantingBomb) {
      e.plantingBomb = true;
      e.bombTimer = 3.0; // seconds
      return;
    }
    e.bombTimer -= dt;
    if (e.bombTimer <= 0) {
      gs.dragon.hp -= 30; // heavy explosive damage
      e.hp = 0;
      // ensure rewards-on-kill if you're using grantOnKillOnce
      if (typeof grantOnKillOnce === 'function') grantOnKillOnce(gs, e);
    }
    return;
  }

  // Others swing intermittently; Hero lowers shield while striking
  if (Math.random() < 0.02) {
    gs.dragon.hp -= dmgForType(e.type);
    if (e.type === 'hero') e.shieldUp = false;
  } else if (e.type === 'hero') {
    e.shieldUp = true;
  }
}


function dmgForType(t) {
  const k = String(t).toLowerCase();
  if (k === 'villager') return 1;
  if (k === 'squire') return 2;
  if (k === 'hero') return 4;
  if (k === 'knight') return 3;
  if (k === 'kingsguard') return 6;
  if (k === 'engineer') return 0;
  return 1;
}

// -------- Dragon breath --------
function dragonBreathTick(dt, gs) {
  const ds = getDragonStats(gs); // {power, reachTiles, breathsPerSec, burnDps, burnDuration}
  const period = 1 / Math.max(0.0001, ds.breathsPerSec || ds.speed || 1.0);
  gs._breathAcc = (gs._breathAcc || 0) + dt;

  while (gs._breathAcc >= period) {
    gs._breathAcc -= period;
    dragonBreathFire(gs, ds);
  }
}

function dragonBreathFire(gs, ds) {
  const reachTiles = ds.reachTiles ?? ds.reach ?? 0;
  if (reachTiles <= 0) return;

  const active = (gs.enemies || [])
    .filter(e => e.hp > 0 && e.spawnDelay <= 0)
    .sort((a, b) => a.pathIndex - b.pathIndex);

  if (active.length === 0 || gs.path.length === 0) return;

  const maxIndex = active[active.length - 1].pathIndex | 0;
  const minIndex = Math.max(0, maxIndex - reachTiles + 1);
  const targets = active.filter(e => e.pathIndex >= minIndex && e.pathIndex <= maxIndex);

  // Hero shield blocks POWER to itself + units behind it (toward dragon)
  let heroIdx = -1;
  for (let i = targets.length - 1; i >= 0; i--) {
    const e = targets[i];
    if (e.type === 'hero' && e.shieldUp && e.hp > 0) { heroIdx = i; break; }
  }

  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];

    // Burn always applies
    applyBurn(e, ds.burnDps, ds.burnDuration);

    // Power may be blocked
    let canPower = true;
    if (e.type === 'hero' && e.shieldUp) canPower = false;
    if (heroIdx !== -1 && i > heroIdx) canPower = false;

    if (canPower) {
      e.hp -= ds.power;
      if (e.hp <= 0) grantOnKillOnce(gs, e);
      if (e.type === 'kingsguard') kingsguardDodgeMaybe(e);
    }
  }
}
