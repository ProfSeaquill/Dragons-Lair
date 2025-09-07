// scaling.js — enemy scaling curves, wave composition, and rewards
//
// No imports from state.js are required here. We keep this self-contained
// so it won't break if state.js changes its exports (e.g., initState vs GameState).

// --- Enemy stat helpers ---
// Rough baselines; tweak as you balance. Wave multipliers apply on top.
const BASE = {
  villager:  { hp: 14,  speed: 2.0, gold: 2, bones: 1 },
  squire:    { hp: 28,  speed: 2.6, gold: 4, bones: 2 },
  hero:      { hp: 90,  speed: 1.4, gold: 10, bones: 4, shield: true },
  knight:    { hp: 80,  speed: 3.2, gold: 8, bones: 3, mounted: true },
  kingsguard:{ hp: 550, speed: 2.4, gold: 40, bones: 16, miniboss: true, mounted: true },
  engineer:  { hp: 55,  speed: 2.2, gold: 7, bones: 3, digger: true },
};

// Global wave multipliers — soft exponential with a small additive bump
function waveHpMult(wave)     { return 1 + 0.22 * (wave - 1) + Math.pow(1.06, wave - 1) - 1; }
function waveSpeedMult(wave)  { return 1 + 0.015 * (wave - 1); } // gentle increase
function bossHpBonus(wave)    { return 1 + 0.25 * Math.floor(wave / 5); }

// Public: compute concrete stats for a unit at a given wave
export function enemyStats(type, wave) {
  const b = BASE[type];
  if (!b) throw new Error(`Unknown enemy type: ${type}`);
  const hp = Math.round(b.hp * waveHpMult(wave) * (b.miniboss ? bossHpBonus(wave) : 1));
  const speed = +(b.speed * waveSpeedMult(wave)).toFixed(3);
  return {
    type,
    hp,
    speed,
    shield: !!b.shield,     // Hero shield blocks Power to itself + units behind, Burn still applies
    mounted: !!b.mounted,   // Knight/Kingsguard flavor (may affect targeting later)
    miniboss: !!b.miniboss, // Kingsguard every 5 waves
    digger: !!b.digger,     // Engineer burrow/bomb behavior handled in combat.js
  };
}

// --- Wave composition ---
// Return either an array of {type, count} objects OR a map; our UI accepts both.
// We’ll return an array for clarity.
export function waveComposition(wave /*, gs */) {
  // Baseline quantities
  const v = Math.max(6, 6 + Math.floor(wave * 1.6));
  const s = wave >= 2 ? Math.floor(wave * 0.9) : 0;
  const k = wave >= 4 ? Math.floor((wave - 2) * 0.6) : 0;
  const h = wave >= 3 ? (wave % 3 === 0 ? 1 : 0) : 0; // occasional hero
  const e = wave >= 5 ? (wave % 4 === 0 ? 1 : 0) : 0; // occasional engineer

  const comp = [
    { type: 'villager', count: v },
    { type: 'squire',   count: s },
  ];

  if (k > 0) comp.push({ type: 'knight', count: k });
  if (h > 0) comp.push({ type: 'hero', count: h });
  if (e > 0) comp.push({ type: 'engineer', count: e });

  // Miniboss every 5th wave
  if (wave % 5 === 0) comp.push({ type: 'kingsguard', count: 1 });

  return comp;
}

// --- Rewards ---
// Gold/Bones per kill; can optionally scale a bit with wave.
export function rewardsFor(type, wave) {
  const b = BASE[type];
  if (!b) return { gold: 0, bones: 0 };
  // Light wave-based ramp to keep upgrades flowing
  const mult = 1 + 0.02 * (wave - 1);
  const gold  = Math.max(1, Math.round(b.gold  * mult));
  const bones = Math.max(1, Math.round(b.bones * mult * 0.9)); // bones ramp slightly slower
  return { gold, bones };
}

// Convenience: compute total rewards of a composition (useful for preview UI or tuning)
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
