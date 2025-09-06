// scaling.js
import { GameState } from './state.js';

export function enemyHPBase(type) {
  const w = GameState.wave;
  const base = 10 + w * 2;
  switch (type) {
    case 'Villager':   return base;
    case 'Squire':     return base * 1.6;
    case 'Hero':       return base * 2.2;
    case 'Knight':     return base * 2.8;
    case 'Kingsguard': return base * 6;
    case 'Engineer':   return base * 1.8;
    default:           return base;
  }
}

export function enemySpeed(type) {
  switch (type) {
    case 'Villager':   return 1.0;
    case 'Squire':     return 1.25;
    case 'Hero':       return 0.7;
    case 'Knight':     return 1.6; // horsed
    case 'Kingsguard': return 1.2; // mounted but heavy
    case 'Engineer':   return 1.0;
    default:           return 1.0;
  }
}

export function enemyDamage(type) {
  switch (type) {
    case 'Villager':   return 4;
    case 'Squire':     return 7;
    case 'Hero':       return 12; // slow swings
    case 'Knight':     return 14;
    case 'Kingsguard': return 22;
    case 'Engineer':   return 0;  // damage via bomb
    default:           return 5;
  }
}

export function goldReward(type) {
  switch (type) {
    case 'Villager':   return 2;
    case 'Squire':     return 3;
    case 'Hero':       return 6;
    case 'Knight':     return 7;
    case 'Kingsguard': return 25;
    case 'Engineer':   return 5;
    default:           return 2;
  }
}

export function bonesReward(type) {
  switch (type) {
    case 'Villager':   return 1;
    case 'Squire':     return 1;
    case 'Hero':       return 2;
    case 'Knight':     return 2;
    case 'Kingsguard': return 5;
    case 'Engineer':   return 2;
    default:           return 1;
  }
}

export function waveComposition(wave) {
  // Simple starter composition; tweak later
  const list = [];
  const add = (type, count) => { for (let i = 0; i < count; i++) list.push(type); };
  const base = 6 + Math.floor(wave * 0.6);
  add('Villager', Math.max(4, base));
  if (wave >= 2) add('Squire', Math.floor(wave / 2));
  if (wave >= 3) add('Knight', Math.floor((wave - 1) / 2));
  if (wave >= 4) add('Hero', Math.floor((wave - 2) / 3));
  if (wave >= 5) add('Engineer', Math.floor((wave - 3) / 3));
  if (wave % 5 === 0) add('Kingsguard', 1);
  return list;
}
