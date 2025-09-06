import { state, save } from './state.js';
import { cost } from './scaling.js';
import { refreshUpgradeButtons, updateUI } from './ui.js';

export function tryUpgradeDamage(){
  const c = cost.dmg(state.L);
  if (state.gold < c) return;
  state.gold -= c; state.L.dmg++; state.damage += 1; save(); updateUI();
}
export function tryUpgradeRate(){
  const c = cost.rate(state.L);
  if (state.gold < c) return;
  state.gold -= c; state.L.rate++; state.ticksPerSec = Math.min(50, +(state.ticksPerSec*1.1).toFixed(2));
  save(); updateUI();
}
export function tryUpgradeBurn(){
  const c = cost.burn(state.L);
  if (state.gold < c) return;
  state.gold -= c; state.L.burn++; state.burnPerSec += 1; save(); updateUI();
}
export function tryUpgradePierce(){
  const c = cost.pierce(state.L);
  if (state.gold < c) return;
  state.gold -= c; state.L.pierce++; state.pierce = Math.min(0.9, +(state.pierce + 0.04).toFixed(2));
  save(); updateUI();
}
export function upgradeButtonTexts(){
  return {
    dmg: `Upgrade Fire Damage (+1) – ${cost.dmg(state.L)}g`,
    rate:`Upgrade Fire Rate (+10%) – ${cost.rate(state.L)}g`,
    burn:`Unlock/Upgrade Burn (+1/sec) – ${cost.burn(state.L)}g`,
    pierce:`Upgrade Piercing (+4%) – ${cost.pierce(state.L)}g`,
  };
}

