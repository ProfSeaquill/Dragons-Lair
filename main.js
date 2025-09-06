import { load } from './state.js';
import { createRenderer } from './render.js';
import { startWave } from './combat.js';
import { tryUpgradeDamage, tryUpgradeRate, tryUpgradeBurn, tryUpgradePierce } from './upgrades.js';
import { wireUI, updateUI } from './ui.js';

const canvas = document.getElementById('game');
createRenderer(canvas);

wireUI({
  onStart: startWave,
  onUpgrade: {
    dmg:   tryUpgradeDamage,
    rate:  tryUpgradeRate,
    burn:  tryUpgradeBurn,
    pierce:tryUpgradePierce
  }
});

load();
updateUI();
setTimeout(()=> startWave(), 600);
