// scaling.js — enemy scaling curves, wave composition, rewards (101-wave run)
// Self-contained: no imports from state.js.

// --- Enemy stat helpers ---
// Baselines; wave multipliers apply on top.
const BASE = {
  villager:  { hp: 10,  speed: 1.2, gold: 2,  bones: 1 },
  squire:    { hp: 20,  speed: 1.4, gold: 4,  bones: 2 },
  hero:      { hp: 70,  speed: 1.5, gold: 10, bones: 4, shield: true },
  knight:    { hp: 50,  speed: 2.3, gold: 8,  bones: 10, mounted: true },
  kingsguard:{ hp: 200, speed: 2.0, gold: 40, bones: 12, miniboss: true, mounted: true, dodge: true },
  engineer:  { hp: 40,  speed: 1.3, gold: 7,  bones: 3, digger: true },
};

// 10th-wave Round Table lineup; 101st is Arthur
const ROUND_TABLE = [
  "Lancelot","Gawain","Percival","Galahad","Tristan",
  "Bors","Bedivere","Gareth","Kay","Mordred"
];

// Global growth knobs (kept gentle; balances against unlimited upgrades)
function waveHpMult(wave)    { return 1 + 0.22 * (wave - 1) + Math.pow(1.06, wave - 1) - 1; } // soft exp + linear
function waveSpeedMult(wave) { return 1 + 0.015 * (wave - 1); }                                // gentle speed creep

// Boss power multipliers relative to kingsguard baseline
const BOSS_MULT   = 6.0;   // for named knights
const ARTHUR_MULT = 18.0;  // final boss

function isBossType(type)     { return typeof type === "string" && type.startsWith("boss:"); }
function bossName(type)       { return isBossType(type) ? type.split(":")[1] : null; }
function bossMultFor(type)    { return bossName(type) === "Arthur" ? ARTHUR_MULT : BOSS_MULT; }

// Public: compute concrete stats for a unit at a given wave
export function enemyStats(type, wave) {
  // Support special boss types: 'boss:<Name>' scale from kingsguard template
  if (isBossType(type)) {
    const name = bossName(type);
    const base = BASE.kingsguard;
    const mult = bossMultFor(type);
    const hp    = Math.round(base.hp * waveHpMult(wave) * mult);
    const speed = +(base.speed * waveSpeedMult(wave)).toFixed(3);
    return {
      type,
      hp,
      speed,
      shield: false,
      mounted: true,
      miniboss: true, // still treated as miniboss for behavior hooks
      digger: false,
      dodge: true,    // inherits kingsguard-style dodge/micro if your combat uses it
      name
    };
  }

  const b = BASE[type];
  if (!b) throw new Error(`Unknown enemy type: ${type}`);
  const hp = Math.round(b.hp * waveHpMult(wave) * (b.miniboss ? (1 + 0.25 * Math.floor(wave / 5)) : 1));
  const speed = +(b.speed * waveSpeedMult(wave)).toFixed(3);
  return {
    type,
    hp,
    speed,
    shield: !!b.shield,     // Hero shield blocks Power to itself + units behind; Burn still applies
    mounted: !!b.mounted,
    miniboss: !!b.miniboss, // Kingsguard every 5 waves (unless replaced by Round Table)
    digger: !!b.digger,
    dodge: !!b.dodge
  };
}

// --- Wave composition ---
// Returns an array of {type, count}. 10th waves get Round Table boss instead of Kingsguard.
// Wave 101 gets King Arthur.
export function waveComposition(wave /*, gs */) {
  // Baseline quantities (kept from your original shape)
  const v = Math.max(6, 6 + Math.floor(wave * 1.6));
  const s = wave >= 2 ? Math.floor(wave * 0.9) : 0;
  const k = wave >= 4 ? Math.floor((wave - 2) * 0.6) : 0;
  const h = wave >= 5 ? (wave % 3 === 0 ? 1 : 0) : 0; // occasional hero
  const e = wave >= 10 ? (wave % 4 === 0 ? 1 : 0) : 0; // occasional engineer

  const comp = [
    { type: 'villager', count: v },
    { type: 'squire',   count: s },
  ];

  if (k > 0) comp.push({ type: 'knight',   count: k });
  if (h > 0) comp.push({ type: 'hero',     count: h });
  if (e > 0) comp.push({ type: 'engineer', count: e });

  // Miniboss cadence:
  // - Every 5th wave normally spawns Kingsguard.
  // - On waves 10,20,...,100 spawn a named Round Table boss instead.
  // - Wave 101 spawns King Arthur.
  if (wave === 101) {
    comp.push({ type: 'boss:Arthur', count: 1 });
  } else if (wave % 10 === 0 && wave <= 100) {
    const idx = (wave / 10 | 0) - 1; // 10→0, 20→1, ..., 100→9
    const name = ROUND_TABLE[idx] || "Lancelot";
    comp.push({ type: `boss:${name}`, count: 1 });
  } else if (wave % 5 === 0) {
    comp.push({ type: 'kingsguard', count: 1 });
  }

  return comp;
}

// === Engineer tunneling (unchanged) ===
export const ENGINEER_UNDERGROUND_SPEED = 2.25; // tiles per second equivalent; tune to taste
export const ENGINEER_UNDERGROUND_IMMUNE = true; // while burrowed, ignore dragon breath / dots

// --- Rewards ---
// Gold/Bones per kill; gently scale with wave. Bosses pay more.
// Keep API compatible with your original rewardsFor(type, wave).
const REWARD_GROWTH = 1.06; // mild multiplicative growth per wave

export function rewardsFor(type, wave) {
  const boss = isBossType(type);
  const baseKey = boss ? 'kingsguard' : type;
  const b = BASE[baseKey];
  if (!b) return { gold: 0, bones: 0 };

  // Mild per-wave ramp to keep upgrades flowing
  const waveMult = Math.pow(REWARD_GROWTH, Math.max(0, wave - 1));

  // Bosses pay extra, but less than raw HP multiplier to avoid runaway economy
  let bossPayoutMult = 1;
  if (boss) {
    const m = bossMultFor(type);
    bossPayoutMult = 0.5 * m + 0.5; // e.g. 6x HP → ~3.5x payout
  }

  const gold  = Math.max(1, Math.round(b.gold  * waveMult * bossPayoutMult));
  const bones = Math.max(1, Math.round(b.bones * Math.pow(REWARD_GROWTH, (wave - 1) * 0.9) * bossPayoutMult));
  return { gold, bones };
}

// Convenience: total rewards of a composition (useful for preview UI or tuning)
export function compositionRewards(wave) {
  const comp = waveComposition(wave);
  let gold = 0, bones = 0;
  for (const { type, count } of comp) {
    const r = rewardsFor(type, wave);
    gold  += r.gold  * count;
    bones += r.bones * count;
  }
  return { gold, bones };
}
