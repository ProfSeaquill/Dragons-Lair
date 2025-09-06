import { state, save } from './state.js';
import { waveHP, bossHP, reward } from './scaling.js';
import { updateUI, updateHUD } from './ui.js';

let tickTimer = null, burnTimer = null;

export function startWave(){
  if (state.inWave) return;
  state.inWave = true;
  state.isBoss = (state.wave % 5 === 0);
  state.enemyMaxHP = state.isBoss ? bossHP(state.wave) : waveHP(state.wave);
  state.enemyHP = state.enemyMaxHP;
  state.enemyArmor = state.isBoss ? Math.min(0.6, 0.25 + state.wave*0.01)
                                  : Math.min(0.35, 0.08 + state.wave*0.005);
  updateUI();

  const tickMs = Math.max(60, Math.floor(1000 / state.ticksPerSec));
  clearInterval(tickTimer);
  tickTimer = setInterval(()=> applyDamage(state.damage, false), tickMs);

  clearInterval(burnTimer);
  if (state.burnPerSec>0) {
    burnTimer = setInterval(()=> applyDamage(state.burnPerSec, true), 1000);
  }
}

export function endWave(victory){
  state.inWave = false;
  clearInterval(tickTimer); clearInterval(burnTimer);
  if (victory){
    state.gold += reward(state.wave, state.isBoss);
    state.wave += 1;
    save();
  }
  updateUI();
  if (state.autoStart){ setTimeout(()=> startWave(), 1200); }
}

function effectiveArmor(){
  const armor = state.enemyArmor * (1 - state.pierce);
  return Math.max(0, Math.min(0.95, armor));
}

export function applyDamage(amountPerTick, isBurn){
  let dmg = amountPerTick;
  if (isBurn) { /* per-second already */ }
  dmg = dmg * (1 - effectiveArmor());
  state.enemyHP -= dmg;
  if (state.enemyHP <= 0){ state.enemyHP = 0; endWave(true); }
  updateHUD();
}
