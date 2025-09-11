// scaling.js — 101-wave run, Round Table bosses, economy curves

import { MAX_WAVES } from "./state.js";

// Global ramps
export const WAVE_GROWTH   = 1.090; // Enemy HP multiplier per wave
export const PACK_GROWTH   = 1.030; // Pack size growth per wave
export const REWARD_GROWTH = 1.090; // Reward growth per wave
export const REWARD_PER_HP = 0.06;  // Base gold per HP defeated

// Boss multipliers (vs. Kingsguard template)
export const BOSS_MULT   = 6.0;
export const ARTHUR_MULT = 18.0;

// Base templates (wave 1 before scaling)
const BASE = {
  villager:   { hp: 30,   speed: 1.00, gold: 2,  bones: 1 },
  squire:     { hp: 60,   speed: 1.15, gold: 4,  bones: 2 },
  hero:       { hp: 250,  speed: 0.90, gold: 12, bones: 4, shield: true },
  knight:     { hp: 120,  speed: 1.40, gold: 8,  bones: 3, mounted: true },
  engineer:   { hp: 140,  speed: 1.10, gold: 10, bones: 4, engineer: true },
  kingsguard: { hp: 800,  speed: 1.25, gold: 60, bones: 18, bossish: true, mounted: true, dodge: true }
};

export const ROUND_TABLE = [
  "Lancelot","Gawain","Percival","Galahad","Tristan",
  "Bors","Bedivere","Gareth","Kay","Mordred"
];

export function waveMultiplier(wave) {
  return Math.pow(WAVE_GROWTH, Math.max(0, wave - 1));
}

function scaledRewards(base, wave) {
  // Rewards scale roughly with HP + a global per-wave growth
  const goldBase  = base.gold + base.hp * REWARD_PER_HP;
  const gold      = Math.round(goldBase * Math.pow(REWARD_GROWTH, wave - 1));
  const bones     = Math.max(1, Math.round(base.bones * Math.pow(REWARD_GROWTH, (wave - 1) * 0.9)));
  return { gold, bones };
}

export function scaledEnemy(baseKey, wave, extraMult = 1) {
  const base = BASE[baseKey];
  const m    = waveMultiplier(wave) * extraMult;
  const hp   = Math.round(base.hp * m);
  const speed = +(base.speed * (1 + 0.02 * Math.floor(wave / 20))).toFixed(2);
  const { gold, bones } = scaledRewards(base, wave);
  const extras = {};
  if (base.shield) extras.shield = true;
  if (base.mounted) extras.mounted = true;
  if (base.engineer) extras.engineer = true;
  if (base.dodge) extras.dodge = true;

  return { hp, speed, gold, bones, ...extras };
}

export function enemyStatsFor(wave, kind) {
  if (kind.startsWith("boss:")) {
    const name = kind.split(":")[1];
    const mult = name === "Arthur" ? ARTHUR_MULT : BOSS_MULT;
    const core = scaledEnemy("kingsguard", wave, mult);
    return { ...core, boss: true, name };
  }
  return scaledEnemy(kind, wave, 1);
}

export function wavePackSize(wave) {
  const base = 10 * Math.pow(PACK_GROWTH, wave - 1);
  const spike = (wave % 10 === 0) ? 6 : 0;
  return Math.floor(base + spike);
}

export function waveComposition(wave) {
  const n = wavePackSize(wave);
  const comp = [];

  const v  = Math.floor(n * 0.45);
  const sq = Math.floor(n * Math.min(0.25, 0.10 + wave * 0.005));
  const kn = Math.floor(n * Math.min(0.20, 0.05 + wave * 0.004));
  const he = Math.floor(n * (wave > 12 ? 0.06 : 0));
  const en = Math.floor(n * (wave > 18 ? 0.04 : 0));
  const remain = Math.max(0, n - (v + sq + kn + he + en));

  comp.push({ kind: "villager", n: v + remain });
  if (sq) comp.push({ kind: "squire", n: sq });
  if (kn) comp.push({ kind: "knight", n: kn });
  if (he) comp.push({ kind: "hero", n: he });
  if (en) comp.push({ kind: "engineer", n: en });

  let boss = null;
  if (wave % 5 === 0) {
    if (wave % 10 === 0 && wave <= 100) {
      const ix = (wave / 10 | 0) - 1; // 10→0, 20→1, ...
      boss = { kind: `boss:${ROUND_TABLE[ix]}` };
    } else {
      boss = { kind: "kingsguard" };
    }
  }
  if (wave === 101) boss = { kind: "boss:Arthur" };

  return { comp, boss };
}

// Helper for UI preview
export function roundTableNameForWave(w) {
  if (w % 10 !== 0 || w > 100) return null;
  return ROUND_TABLE[(w / 10 | 0) - 1] || null;
}
