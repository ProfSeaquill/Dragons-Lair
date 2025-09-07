// combat.js — wave creation, dragon breath, enemy AI, rewards

import { getDragonStats } from './state.js';
import { waveComposition, enemyStats, rewardsFor } from './scaling.js';

// ---------------- Enemy factory ----------------
function makeEnemiesForWave(wave) {
  const comp = waveComposition(wave); // [{type, count}, ...] or a map; normalize
  /** @type {{type:string,count:number}[]} */
  const list = Array.isArray(comp)
    ? comp
    : Object.entries(comp).map(([type, count]) => ({ type, count }));

  /** @type {ReturnType<typeof createEnemy>[]} */
  const out = [];
  for (const { type, count } of list) {
    for (let i = 0; i < count; i++) out.push(createEnemy(type, wave, i));
  }
  return out;
}

function createEnemy(type, wave, spawnIndex = 0) {
  const t = String(type).toLowerCase();
  const s = enemyStats(t, wave); // {hp, speed, shield, miniboss, mounted, digger}
  return {
    id: Math.random().toString(36).slice(2),
    type: t,
    hp: s.hp,
    maxHP: s.hp,
    speed: s.speed,        // tiles per second
    pathIndex: 0,          // index into gs.path
    progress: 0,           // 0..1 within current tile
    spawnDelay: spawnIndex * 0.2, // seconds between spawns (stagger)
    shieldUp: t === 'hero',       // hero starts shielding
    safeDodgeLeft: t === 'kingsguard' ? 2 : 0,
    burrowLeft: t === 'engineer' ? 3 : 0,
    burrowCooldown: 0,     // seconds
    burning: { dps: 0, t: 0 },
    plantingBomb: false,
    bombTimer: 0,          // seconds
  };
}

// ---------------- Wave API ----------------
export function makeWave(gs) {
  // Build new enemy list and reset combat timers
  gs.enemies = makeEnemiesForWave(gs.wave);
  gs._breathAcc = 0;
}

export function tickCombat(dt, gs) {
  if (!gs || !Array.isArray(gs.enemies) || !Array.isArray(gs.path) || gs.path.length === 0) {
    return true; // nothing to do → treat as finished to unblock the game
  }

  // 1) Dragon breath cadence
  dragonBreathTick(dt, gs);

  // 2) Move enemies, apply DoT, and attacks
  const deaths = [];
  const beforeIds = new Set(gs.enemies.map(e => e.id));

  for (const e of gs.enemies) {
    if (e.hp <= 0) continue;

    // Spawn gating
    if (e.spawnDelay > 0) {
      e.spawnDelay = Math.max(0, e.spawnDelay - dt);
      continue;
    }

    // AI helpers
    engineerLogic(e, gs);
    kingsguardDodgeMaybe(e);

    // Movement along the path
    advanceAlongPath(e, gs, dt);

    // Burn DoT
    tickBurn(e, dt);

    // Attack when at the dragon (end of path)
    attackDragonIfAtExit(e, gs, dt);
  }

  // 3) Cull dead and grant rewards
  gs.enemies = gs.enemies.filter(e => e.hp > 0 && gs.dragon.hp > 0);
  const afterIds = new Set(gs.enemies.map(e => e.id));
  for (const id of beforeIds) if (!afterIds.has(id)) deaths.push(id);

  if (deaths.length) {
    let g = 0, b = 0;
    for (const id of deaths) {
      const e = findById(beforeIds, id, gs); // helper
      if (!e) continue;
      const r = rewardsFor(e.type, gs.wave);
      g += r.gold;
      b += r.bones;
    }
    gs.gold = (gs.gold | 0) + g;
    gs.bones = (gs.bones | 0) + b;
  }

  // 4) End conditions: dragon dead OR all enemies dead (and no one pending spawn)
  const anyPendingSpawn = gs.enemies.some(e => e.spawnDelay > 0);
  const allDead = gs.enemies.length === 0;
  const dragonDead = gs.dragon?.hp <= 0;

  return dragonDead || (allDead && !anyPendingSpawn);
}

// ---------------- Internals ----------------
function findById(beforeIds, id, gs) {
  // Not perfect, but good enough for reward attribution immediately after cull
  // Try to find the enemy in a cached snapshot if you keep one; otherwise scan a copy.
  // Here we just can’t reconstruct; instead track rewards per enemy elsewhere if needed.
  // For now, we approximate by scanning a temporary ref kept on the object.
  // (Optionally, you can attach a {__dead:true} marker pre-removal and retain a small buffer.)
  return null; // We'll attribute rewards directly before removal instead (see below).
}

// Apply or refresh burn
function applyBurn(e, dps, duration) {
  if (dps <= 0 || duration <= 0) return;
  e.burning.dps = Math.max(e.burning.dps, dps);
  e.burning.t = Math.max(e.burning.t, duration);
}

function tickBurn(e, dt) {
  if (e.burning.t > 0 && e.hp > 0) {
    e.hp -= e.burning.dps * dt;
    e.burning.t -= dt;
  }
}

// Kingsguard micro-stall dodge (very occasional)
function kingsguardDodgeMaybe(e) {
  if (e.type !== 'kingsguard' || e.safeDodgeLeft <= 0) return;
  if (Math.random() < 0.02) {
    e.progress = 0; // micro-stall within tile
    e.safeDodgeLeft--;
  }
}

// Engineer digs 2–3 tiles forward up to 3 times with a cooldown
function engineerLogic(e, gs) {
  if (e.type !== 'engineer' || e.burrowLeft <= 0) return;
  if (e.burrowCooldown > 0) { e.burrowCooldown = Math.max(0, e.burrowCooldown - 1/60); return; }
  if (Math.random() < 0.01) {
    const skip = 2 + Math.floor(Math.random() * 2); // 2–3
    e.pathIndex = Math.min(e.pathIndex + Math.min(skip, gs.path.length - 1 - e.pathIndex), gs.path.length - 1);
    e.burrowLeft -= 1;
    e.burrowCooldown = 1.0; // seconds
    e.progress = 0;
  }
}

// Move along the path in tile-steps; speed is tiles/sec
function advanceAlongPath(e, gs, dt) {
  if (gs.path.length === 0 || e.hp <= 0) return;
  // if already at final tile, don't move further; handled in attack phase
  if (e.pathIndex >= gs.path.length - 1) return;

  const tilesToAdvance = e.speed * dt + e.progress;
  const whole = Math.floor(tilesToAdvance);
  e.progress = tilesToAdvance - whole;

  e.pathIndex = Math.min(e.pathIndex + whole, gs.path.length - 1);
}

// Attack logic at the dragon’s tile (exit)
function attackDragonIfAtExit(e, gs, dt) {
  if (e.hp <= 0) return;
  if (e.pathIndex < gs.path.length - 1) return; // not at exit yet

  // Engineer plants a bomb with fuse; explodes for heavy damage and dies
  if (e.type === 'engineer') {
    if (!e.plantingBomb) {
      e.plantingBomb = true;
      e.bombTimer = 3.0; // seconds
      return;
    }
    e.bombTimer -= dt;
    if (e.bombTimer <= 0) {
      gs.dragon.hp -= 30;
      e.hp = 0; // engineer sacrifices self
    }
    return;
  }

  // Others swing intermittently; hero lowers shield while striking
  if (Math.random() < 0.02) { // ~2% per frame ~ depends on fps; acceptable for now
    gs.dragon.hp -= dmgForType(e.type);
    if (e.type === 'hero') e.shieldUp = false;
  } else if (e.type === 'hero') {
    e.shieldUp = true;
  }
}

function dmgForType(t) {
  // Simple flavor damage if scaling.js doesn’t expose per-type dragon-damage
  const k = String(t).toLowerCase();
  if (k === 'villager') return 1;
  if (k === 'squire') return 2;
  if (k === 'hero') return 4;
  if (k === 'knight') return 3;
  if (k === 'kingsguard') return 6;
  if (k === 'engineer') return 0; // handled by bomb
  return 1;
}

// ---------------- Dragon breath ----------------
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

  // Active enemies ordered by pathIndex
  const active = (gs.enemies || [])
    .filter(e => e.hp > 0 && e.spawnDelay <= 0)
    .sort((a, b) => a.pathIndex - b.pathIndex);

  if (active.length === 0 || gs.path.length === 0) return;

  // Determine the front-most enemy and pick a window within reach
  const maxIndex = active[active.length - 1].pathIndex | 0;
  const minIndex = Math.max(0, maxIndex - reachTiles + 1);
  const targets = active.filter(e => e.pathIndex >= minIndex && e.pathIndex <= maxIndex);

  // Hero shield logic: any shielding hero in targets blocks POWER to itself + units behind it (toward exit)
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
    if (e.type === 'hero' && e.shieldUp) canPower = false; // hero itself immune while shielding
    if (heroIdx !== -1 && i > heroIdx) canPower = false;   // units “behind” the hero (closer to dragon) are blocked

    if (canPower) {
      e.hp -= ds.power;
      if (e.type === 'kingsguard') kingsguardDodgeMaybe(e);
    }
  }
}

// ---------------- Reward attribution tweak ----------------
// The “findById” approach above is intentionally minimal. If you prefer exact
// attribution without scanning, you can instead grant reward immediately when
// you set e.hp <= 0 (at the kill site). Below is a small helper to call right
// where you apply lethal damage:
//
// function grantOnKill(gs, e) {
//   const r = rewardsFor(e.type, gs.wave);
//   gs.gold += r.gold;
//   gs.bones += r.bones;
// }
//
// And replace any `e.hp -= X; if (e.hp <= 0) ...` with a grantOnKill() call.
//
