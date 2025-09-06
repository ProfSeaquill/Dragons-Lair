import { GameState, UpgradeSteps } from './state.js';


export function getUpgradeInfo(){
const u = GameState.dragon;
return [
{ key:'power', name:'Power', lvl:u.powerLvl, max: UpgradeSteps.power.length-1, cost: 20*(u.powerLvl+1) },
{ key:'reach', name:'Reach', lvl:u.reachLvl, max: UpgradeSteps.reach.length-1, cost: 25*(u.reachLvl+1) },
{ key:'speed', name:'Speed', lvl:u.speedLvl, max: UpgradeSteps.speed.length-1, cost: 30*(u.speedLvl+1) },
{ key:'burn', name:'Burn', lvl:u.burnLvl, max: UpgradeSteps.burn.length-1, cost: 35*(u.burnLvl+1) },
];
}


export function buyUpgrade(key){
const info = getUpgradeInfo().find(x=>x.key===key);
if (!info) return false;
if (info.lvl>=info.max) return false;
if (GameState.gold < info.cost) return false;
GameState.gold -= info.cost;
GameState.dragon[`${key}Lvl`]++;
return true;
}
