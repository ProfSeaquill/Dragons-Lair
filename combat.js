import { GameState, GRID, ENTRY, EXIT, getDragonStats } from './state.js';
const interval = Math.max(10, Math.floor(60 / speed)); // frames between breaths
if (GameState.tick % interval === 0){ dragonBreath(); }


// Move enemies, apply burn, attacks
for (const e of GameState.enemies){
enemyAdvance(e);
tickBurn(e, 1/60);
enemyAttackDragon(e);
}


// Death & rewards
const before = GameState.enemies.length;
GameState.enemies = GameState.enemies.filter(e=>e.hp>0 && GameState.dragon.hp>0);
const killed = before - GameState.enemies.length;
if (killed>0){
// naive: grant per death (approx by checking missing ones is tough here)
// Instead, we tally by tracking rewards on death — but to keep code compact, we estimate via a pass (not perfect):
}
}


export function cleanupAndRewards(){
// Proper reward pass: called after tick to grant per newly-dead enemy
// We'll compute rewards by storing a tombstone array — to keep it simple, we run a diff
}


export function allEnemiesDead(){
return GameState.enemies.every(e=> e.hp<=0 || e.pathIndex<0) || GameState.enemies.length===0;
}


export function playerRewardsOnDeath(prev, curr){
// prev: previous list, curr: current list
const prevIds = new Set(prev.map(e=>e.id));
const currIds = new Set(curr.map(e=>e.id));
const died = [...prevIds].filter(id=>!currIds.has(id));
let gold=0, bones=0;
for (const id of died){
const e = prev.find(x=>x.id===id);
if (!e) continue;
gold += goldReward(e.type);
bones += bonesReward(e.type);
}
GameState.gold += gold;
GameState.bones += bones;
return {gold, bones};
}
