// scaling.js — enemy scaling curves, wave composition, rewards (101-wave run)
// Self-contained: no imports from state.js.

// --- Enemy stat helpers ---
const BASE = {
  villager:  { hp: 10,  speed: 1.2, gold: 2,  bones: 1 },
  squire:    { hp: 20,  speed: 1.4, gold: 4,  bones: 2 },
  hero:      { hp: 70,  speed: 1.5, gold: 10, bones: 4, shield: true },
  knight:    { hp: 50,  speed: 2.3, gold: 8,  bones: 10, mounted: true },
  kingsguard:{ hp: 70,  speed: 1.3, gold: 40, bones: 12, miniboss: true, mounted: true }, // no dodge
  engineer:  { hp: 40,  speed: 1.3, gold: 7,  bones: 3, digger: true },
};

// 10th-wave Round Table lineup; 101st is Arthur
const ROUND_TABLE = [
  "Lancelot","Gawain","Percival","Galahad","Tristan",
  "Bors","Bedivere","Gareth","Kay","Mordred"
];

// Wave multipliers
function waveHpMult(wave)     { return 1 + 0.22 * (wave - 1) + Math.pow(1.06, wave - 1) - 1; } // soft-exp HP
function waveSpeedMult(wave)  { return 1 + 0.015 * (wave - 1); }                                 // gentle speed
function bossHpBonus(wave)    { return 1 + 0.25 * Math.floor(wave / 5); }                        // optional

// Boss tuning
const BOSS_MULT   = 6.0;   // Round Table bosses are ~6x kingsguard baseline HP
const ARTHUR_MULT = 18.0;  // Arthur is extra buff

// Flat reward multipliers (no wave reward scaling)
const BOSS_REWARD_MULT   = 3.0;
const ARTHUR_REWARD_MULT = 6.0;

function isBossType(type)     { return typeof type === "string" && type.startsWith("boss:"); }
function bossName(type)       { return isBossType(type) ? type.split(":")[1] : null; }
function bossMultFor(type)    { return bossName(type) === "Arthur" ? ARTHUR_MULT : BOSS_MULT; }
function bossRewardMult(type) { return bossName(type) === "Arthur" ? ARTHUR_REWARD_MULT : BOSS_REWARD_MULT; }

// --- Public: compute stats for a unit at a given wave ---
// Wave scaling applies to HP and Speed only; other flags are from BASE.
export function enemyStats(type, wave) {
  const t = String(type);

  // Boss types: 'boss:<Name>' scale from kingsguard template
  if (isBossType(t)) {
    const base  = BASE.kingsguard;
    const mult  = bossMultFor(t);
    const hp    = Math.round(base.hp * waveHpMult(wave) * mult);
    const speed = +(base.speed * waveSpeedMult(wave)).toFixed(3);
    return {
      type: t,
      hp,
      speed,
      shield: false,
      mounted: true,
      miniboss: true, // behavior hooks may check this
      digger: false,
      name: bossName(t),
    };
  }

  // Normal enemies
  const b = BASE[t];
  if (!b) throw new Error(`Unknown enemy type: ${t}`);

  const hp    = Math.round(b.hp * waveHpMult(wave) * (b.miniboss ? bossHpBonus(wave) : 1));
  const speed = +(b.speed * waveSpeedMult(wave)).toFixed(3);
  return {
    type: t,
    hp,
    speed,
    shield: !!b.shield,
    mounted: !!b.mounted,
    miniboss: !!b.miniboss,
    digger: !!b.digger,
  };
}

// --- Wave composition ---
// Returns an array of {type, count}. 10th waves get Round Table boss instead of Kingsguard.
// Wave 101 gets King Arthur.
export function waveComposition(wave /*, gs */) {
  const v = Math.max(6, 6 + Math.floor(wave * 1.6));
  const s = wave >= 2 ? Math.floor(wave * 0.9) : 0;
  const k = wave >= 4 ? Math.floor((wave - 2) * 0.6) : 0;
  const h = wave >= 5 ? (wave % 3 === 0 ? 1 : 0) : 0;
  const e = wave >= 10 ? (wave % 4 === 0 ? 1 : 0) : 0;

  const comp = [
    { type: 'villager', count: v },
    { type: 'squire',   count: s },
  ];
  if (k > 0) comp.push({ type: 'knight',   count: k });
  if (h > 0) comp.push({ type: 'hero',     count: h });
  if (e > 0) comp.push({ type: 'engineer', count: e });

  // Boss cadence:
  // - Waves 10,20,...,100 spawn Round Table boss
  // - Wave 101 spawns King Arthur
  // - Other 5th waves (not multiples of 10) spawn Kingsguard miniboss
  if (wave === 101) {
    comp.push({ type: 'boss:Arthur', count: 1 });
  } else if (wave % 10 === 0 && wave <= 100) {
    const idx = (wave / 10 | 0) - 1; // 10→0, 20→1, …, 100→9
    const name = ROUND_TABLE[idx] || "Lancelot";
    comp.push({ type: `boss:${name}`, count: 1 });
  } else if (wave % 5 === 0) {
    comp.push({ type: 'kingsguard', count: 1 });
  }

  return comp;
}

// === Engineer tunneling (kept) ===
export const ENGINEER_UNDERGROUND_SPEED = 2.25;
export const ENGINEER_UNDERGROUND_IMMUNE = true;

// --- Rewards (FLAT; no wave scaling) ---
export function rewardsFor(type /*, wave */) {
  const boss = isBossType(type);
  const baseKey = boss ? 'kingsguard' : type;
  const b = BASE[baseKey];
  if (!b) return { gold: 0, bones: 0 };

  let mult = 1;
  if (boss) mult = bossRewardMult(type);

  const gold  = Math.max(1, Math.round(b.gold  * mult));
  const bones = Math.max(1, Math.round(b.bones * mult));
  return { gold, bones };
}

// Convenience: total rewards of a composition
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
