// combat.js
import { GameState, GRID, ENTRY, EXIT, getDragonStats } from './state.js';
import {
  waveComposition,
  enemyHPBase,
  enemySpeed,
  enemyDamage,
  goldReward,
  bonesReward,
} from './scaling.js';

// ---------- Enemy factory & helpers ----------
function createEnemy(type) {
  return {
    id: Math.random().toString(36).slice(2),
    type,
    hp: enemyHPBase(type),
    maxHP: enemyHPBase(type),
    pathIndex: 0,       // index into GameState.path
    progress: 0,        // 0..1 within tile (for smoothness if you add later)
    speed: enemySpeed(type),
    dmg: enemyDamage(type),
    shieldUp: type === 'Hero',
    safeDodgeLeft: type === 'Kingsguard' ? 2 : 0,  // miniboss can dodge a couple times
    burrowLeft: type === 'Engineer' ? 3 : 0,       // can skip path segments
    burrowCooldown: 0,
    burning: { dps: 0, t: 0 },
    plantingBomb: false,
    bombTimer: 0,
  };
}

export function makeWave(wave) {
  const comp = waveComposition(wave);
  GameState.enemies = comp.map(t => createEnemy(t));
  // Stagger spawn by using negative pathIndex
  GameState.enemies.forEach((e, i) => { e.pathIndex = -(i * 2); });
}

function applyBurn(e, amount, duration) {
  e.burning.dps = Math.max(e.burning.dps, amount);
  e.burning.t = Math.max(e.burning.t, duration);
}

function tickBurn(e, dt) {
  if (e.burning.t > 0 && e.hp > 0) {
    e.hp -= e.burning.dps * dt;
    e.burning.t -= dt;
  }
}

function tryKingsguardDodge(e) {
  if (e.type !== 'Kingsguard' || e.safeDodgeLeft <= 0) return;
  // Small random chance after being targeted to "hesitate" (light dodge)
  if (Math.random() < 0.02) {
    e.progress = 0; // micro-stall
    e.safeDodgeLeft--;
  }
}

function engineerLogic(e) {
  if (e.type !== 'Engineer' || e.burrowLeft <= 0) return;
  if (e.burrowCooldown > 0) { e.burrowCooldown -= 1; return; }
  // Occasionally skip ahead on the path (simulate digging)
  if (Math.random() < 0.01) {
    const skip = Math.min(2 + Math.floor(Math.random() * 2), e.burrowLeft); // 2-3 tiles
    e.pathIndex += skip;
    e.burrowLeft -= 1;
    e.burrowCooldown = 60; // ~1s cooldown at 60fps
  }
}

function heroShieldingIndex(targets) {
  // Scan from dragon end backward; first active Hero with shield blocks POWER behind it
  for (let i = targets.length - 1; i >= 0; i--) {
    const e = targets[i];
    if (e.type === 'Hero' && e.shieldUp && e.hp > 0) return i;
  }
  return -1;
}

// ---------- Dragon breath ----------
export function dragonBreath() {
  const { power, reach, burn, burnDuration } = getDragonStats();

  // Active enemies ordered by pathIndex
  const active = GameState.enemies
    .filter(e => e.hp > 0 && e.pathIndex >= 0)
    .sort((a, b) => a.pathIndex - b.pathIndex);

  if (active.length === 0 || GameState.path.length === 0) return;

  // Determine the front-most enemy and pick a window of indices within reach
  const maxIndex = Math.max(...active.map(e => e.pathIndex));
  const minTargetIndex = Math.max(0, maxIndex - reach);
  const targets = active.filter(e => e.pathIndex >= minTargetIndex && e.pathIndex <= maxIndex);

  const heroIdx = heroShieldingIndex(targets);

  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];

    // Burn always applies
    applyBurn(e, burn, burnDuration);

    // Power damage logic (Hero immune to Power while shieldUp; units behind hero blocked)
    let canPower = true;

    if (e.type === 'Hero' && e.shieldUp) canPower = false;       // hero itself immune while shielding
    if (heroIdx !== -1 && i > heroIdx) canPower = false;         // enemies behind hero blocked
    if (heroIdx !== -1 && i < heroIdx) canPower = true;          // enemies in front of hero still hit

    if (canPower) {
      e.hp -= power;
      if (e.type === 'Kingsguard') tryKingsguardDodge(e);
    }
  }
}

function atExit(e) {
  return GameState.path.length > 0 && e.pathIndex >= GameState.path.length - 1;
}

function enemyAdvance(e) {
  if (e.hp <= 0) return;

  // spawn gating: negative pathIndex waits off-screen
  if (e.pathIndex < 0) { e.pathIndex++; return; }

  engineerLogic(e);

  // advance along path (simple stepped movement)
  e.progress += 0.02 * e.speed; // tune this delta to adjust movement speed
  if (e.progress >= 1) {
    e.progress = 0;
    e.pathIndex = Math.min(e.pathIndex + 1, GameState.path.length - 1);
  }
}

function enemyAttackDragon(e) {
  // At the dragon tile
  if (!atExit(e)) return;

  // Engineer plants bomb with fuse
  if (e.type === 'Engineer' && !e.plantingBomb) {
    e.plantingBomb = true;
    e.bombTimer = 180; // ~3 seconds at 60fps
    return;
  }
  if (e.type === 'Engineer' && e.plantingBomb) {
    e.bombTimer--;
    if (e.bombTimer <= 0) {
      GameState.dragon.hp -= 30; // heavy explosive damage
      e.hp = 0; // engineer sacrifices self
    }
    return;
  }

  // Others attack intermittently
  if (Math.random() < 0.02) {
    GameState.dragon.hp -= e.dmg;
    if (e.type === 'Hero') e.shieldUp = false;   // shield drops while striking
  } else {
    if (e.type === 'Hero') e.shieldUp = true;    // shield back up when not striking
  }
}

// ---------- Tick / Rewards ----------
export function tickCombat() {
  const { speed } = getDragonStats();
  const interval = Math.max(10, Math.floor(60 / speed)); // frames between breaths
  if (GameState.tick % interval === 0) dragonBreath();

  // Move enemies, apply DoT, attack
  for (const e of GameState.enemies) {
    enemyAdvance(e);
    tickBurn(e, 1 / 60);
    enemyAttackDragon(e);
  }

  // Cull dead / if dragon died, stop
  const before = GameState.enemies.length;
  GameState.enemies = GameState.enemies.filter(e => e.hp > 0 && GameState.dragon.hp > 0);
  const killed = before - GameState.enemies.length;
  // (rewards are granted via playerRewardsOnDeath diff in main loop)
}

export function allEnemiesDead() {
  return (
    GameState.enemies.length === 0 ||
    GameState.enemies.every(e => e.hp <= 0 || e.pathIndex < 0)
  );
}

// Reward diffing helper (called from main loop)
export function playerRewardsOnDeath(prev, curr) {
  const prevIds = new Set(prev.map(e => e.id));
  const currIds = new Set(curr.map(e => e.id));
  const died = [...prevIds].filter(id => !currIds.has(id));
  let gold = 0, bones = 0;
  for (const id of died) {
    const e = prev.find(x => x.id === id);
    if (!e) continue;
    gold += goldReward(e.type);
    bones += bonesReward(e.type);
  }
  GameState.gold += gold;
  GameState.bones += bones;
  return { gold, bones };
}
