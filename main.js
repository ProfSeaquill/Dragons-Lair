import { GameState, GRID, resetGrid, ENTRY, EXIT, getDragonStats } from './state.js';
import { draw } from './render.js';
import { makeWave, tickCombat, allEnemiesDead, playerRewardsOnDeath } from './combat.js';
import { waveComposition } from './scaling.js';


function init(){
resetGrid();
recomputePath();
bindUI();
renderUI();
setupWavePreview();
loop();
}


function setupWavePreview(){
const w = GameState.wave;
const comp = waveComposition(w);
const counts = {};
comp.forEach(t=> counts[t]=(counts[t]||0)+1);
const html = Object.entries(counts).map(([k,v])=>`<div>${k}: ${v}</div>`).join('');
previewNextWave(html);
}


let lastEnemies = [];


function loop(){
GameState.tick++;
// Start wave auto
if (GameState.autoStart && !GameState.running && GameState.enemies.length===0){ startWave(); }


if (GameState.running){
const prev = [...GameState.enemies];
tickCombat();
// Rewards
const {gold,bones} = playerRewardsOnDeath(prev, GameState.enemies);
if (gold||bones) renderUI();


// End of wave
if (allEnemiesDead()){
GameState.running=false;
GameState.wave++;
toast(`Wave cleared! +${gold||0}g +${bones||0} bones`);
setupWavePreview();
}
}


draw();
renderUI();
requestAnimationFrame(loop);
}


function startWave(){
makeWave(GameState.wave);
GameState.running = true;
}


window.addEventListener('start-wave', startWave);
window.addEventListener('grid-changed', ()=>{ setupWavePreview(); });


window.addEventListener('load', init);
