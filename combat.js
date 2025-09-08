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
    pathIndex: 0,              // start at first node after spawn
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
 // normalize legacy negative pathIndex to spawnDelay-based gating
for (const e of gs.enemies) {
  if (typeof e.spawnDelay !== 'number') e.spawnDelay = 0;
  if ((e.pathIndex | 0) < 0) {
    // -1 → 0.2s, -2 → 0.4s, etc.
    e.spawnDelay = Math.max(e.spawnDelay, (-e.pathIndex | 0) * 0.2);
    e.pathIndex = 0;
    e.progress = 0;
  }
}
  gs._breathAcc = 0;
}

export function tickCombat(dt, gs) {
  // timeline + FX decay
  gs._time = (gs._time || 0) + dt;
  if (gs.fx) {
    const arrs = [gs.fx.claw, gs.fx.wing];
    for (const a of arrs) {
      for (let i = a.length - 1; i >= 0; i--) {
        a[i].ttl -= dt;
        if (a[i].ttl <= 0) a.splice(i, 1);
      }
    }
  }
  if (!gs || !Array.isArray(gs.enemies) || !Array.isArray(gs.path) || gs.path.length === 0) return false;

  dragonBreathTick(dt, gs);

  for (const e of gs.enemies) {
    if (e.hp <= 0) continue;

    // spawn gating
    if (e.spawnDelay > 0) { e.spawnDelay = Math.max(0, e.spawnDelay - dt); continue; }

    engineerLogic(e, gs);
    kingsguardDodgeMaybe(e);
    advanceAlongPath(e, gs, dt);

    // Dragon claws auto-swipe adjacent enemies
if (e.pathIndex >= Math.max(0, gs.path.length - 2) && e.hp > 0) {
  const { claws } = getDragonStats(gs);
  if (claws > 0) {
    // spawn a short swipe FX (throttled)
    if ((gs._time - (gs._lastClawFx || 0)) > 0.25) {
      gs._lastClawFx = gs._time;
      gs.fx = gs.fx || { claw: [], wing: [] };
      gs.fx.claw = gs.fx.claw || [];
      gs.fx.claw.push({ ttl: 0.25 });

    }
    e.hp -= claws * dt; // small tick-based damage
    if (e.hp <= 0 && typeof grantOnKillOnce === 'function') grantOnKillOnce(gs, e);
  }
}

    tickBurn(e, dt, gs);
    attackDragonIfAtExit(e, gs, dt);
  }

  // Cull dead enemies (we grant rewards on kill inside tick/breath)
  gs.enemies = gs.enemies.filter(function (e) {
    return e && (e.hp > 0 || e.spawnDelay > 0);
  });

  // End conditions
  var anyAlive = gs.enemies.some(function (e) { return e.hp > 0; });
  var anyPendingSpawn = gs.enemies.some(function (e) { return e.spawnDelay > 0; });
  var dragonDead = (gs.dragon && gs.dragon.hp <= 0);

  if (dragonDead) {
    gs._endedReason = 'defeat';
    return true;
  }
  if (!anyAlive && !anyPendingSpawn) {
    gs._endedReason = 'victory';
    return true;
  }
  return false;
  
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

  // If already at/after lastFightIdx, keep position and drop hero shield
  if (e.pathIndex >= lastFightIdx) {
    if (e.type === 'hero') e.shieldUp = false; // shield stays down near dragon
    return;
  }

  const tilesToAdvance = e.speed * dt + e.progress;
  const whole = Math.floor(tilesToAdvance);
  e.progress = tilesToAdvance - whole;

  e.pathIndex = Math.min(e.pathIndex + whole, lastFightIdx);

  // If we just reached the adjacent tile, drop hero shield
  if (e.pathIndex >= lastFightIdx && e.type === 'hero') {
    e.shieldUp = false;
  }
}



function attackDragonIfAtExit(e, gs, dt) {
  if (e.hp <= 0) return;
  if (!Array.isArray(gs.path) || gs.path.length === 0) return;

  // Units stop and attack from the tile ADJACENT to the dragon
  const lastFightIdx = Math.max(0, gs.path.length - 2);
  if (e.pathIndex < lastFightIdx) return; // not yet adjacent to dragon

  // Engineer: plant a bomb with a short fuse; explodes and kills the engineer
  if (e.type === 'engineer') {
   // Dragon wings gust automatically to push back bombs
    const { wings } = getDragonStats(gs);
  if (wings > 0) {
  // Push engineer back by 'wings' tiles
    e.pathIndex = Math.max(0, e.pathIndex - wings);
    e.plantingBomb = false;
    e.bombTimer = 0;
    // wing gust FX
      gs.fx = gs.fx || { claw: [], wing: [] };
      gs.fx.wing = gs.fx.wing || [];
      gs.fx.wing.push({ ttl: 0.35, strength: wings });

    return;
  }
    
    if (!e.plantingBomb) {
      e.plantingBomb = true;
      e.bombTimer = 10.0; // seconds
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

 if (Math.random() < 0.02) {
  gs.dragon.hp -= dmgForType(e.type);
}
// Hero keeps shield down while at the dragon
if (e.type === 'hero') e.shieldUp = false;
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
  if (reachTiles <= 0 || !Array.isArray(gs.path) || gs.path.length === 0) return;

  // Breath originates at the dragon and goes backward along the path
  const endIdx = Math.max(0, gs.path.length - 2); // we stop enemies on the tile before dragon
  const startIdx = Math.max(0, endIdx - reachTiles + 1);

  // Active, spawned enemies within the breath corridor [startIdx .. endIdx]
  const targets = (gs.enemies || [])
    .filter(e => e.hp > 0 && (e.spawnDelay || 0) <= 0 && e.pathIndex >= startIdx && e.pathIndex <= endIdx)
    .sort((a, b) => a.pathIndex - b.pathIndex); // ascending: entry → dragon

  if (targets.length === 0) return;

  // Hero shield blocks POWER to itself + units behind it (toward the dragon)
  const shieldingHero = targets.find(e => e.type === 'hero' && e.shieldUp && e.hp > 0);

  for (const e of targets) {
    // Burn always applies
    applyBurn(e, ds.burnDps, ds.burnDuration);

    // Power may be blocked
    let canPower = true;
    if (e.type === 'hero' && e.shieldUp) canPower = false;
    if (shieldingHero && e.pathIndex > shieldingHero.pathIndex) canPower = false; // “behind” = closer to dragon

    if (canPower) {
      e.hp -= ds.power;
      if (e.hp <= 0 && typeof grantOnKillOnce === 'function') grantOnKillOnce(gs, e);
      if (e.type === 'kingsguard') kingsguardDodgeMaybe(e);
    }
  }
}
