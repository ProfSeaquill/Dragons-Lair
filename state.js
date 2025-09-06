// Single source of truth + persistence
export const state = {
  wave: 1, gold: 0,
  enemyHP: 0, enemyMaxHP: 0, enemyArmor: 0, isBoss: false, inWave: false, autoStart: true,
  damage: 5, ticksPerSec: 5, burnPerSec: 0, pierce: 0,
  L: { dmg: 0, rate: 0, burn: 0, pierce: 0 }
};

export function save() {
  localStorage.setItem('dragonDefenseSave', JSON.stringify(state));
}
export function load() {
  const raw = localStorage.getItem('dragonDefenseSave');
  if (!raw) return;
  try { Object.assign(state, JSON.parse(raw)); } catch {}
}
