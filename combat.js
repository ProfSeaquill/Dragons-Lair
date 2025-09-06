import { GameState, GRID, ENTRY, EXIT, getDragonStats } from './state.js';
import { waveComposition, enemyHPBase, enemySpeed, enemyDamage, goldReward, bonesReward } from './scaling.js';


// Enemy factory
function createEnemy(type){
return {
id: Math.random().toString(36).slice(2),
type,
hp: enemyHPBase(type),
maxHP: enemyHPBase(type),
pathIndex: 0,
progress: 0, // 0..1 within tile
speed: enemySpeed(type),
dmg: enemyDamage(type),
shieldUp: type==='Hero',
safeDodgeLeft: type==='Kingsguard' ? 2 : 0,
burrowLeft: type==='Engineer' ? 3 : 0,
burrowCooldown: 0,
burning: { dps:0, t:0 },
plantingBomb: false,
bombTimer: 0,
};
}


export function makeWave(wave){
const comp = waveComposition(wave);
GameState.enemies = comp.map(t=>createEnemy(t));
// Stagger spawn: use negative pathIndex to delay spawn
GameState.enemies.forEach((e,i)=>{ e.pathIndex = - (i*2); });
}


function applyBurn(e, amount, duration){
e.burning.dps = Math.max(e.burning.dps, amount);
e.burning.t = Math.max(e.burning.t, duration);
}


function tickBurn(e, dt){
if (e.burning.t>0 && e.hp>0){
e.hp -= e.burning.dps * dt;
e.burning.t -= dt;
}
}


function tryKingsguardDodge(e){
}
