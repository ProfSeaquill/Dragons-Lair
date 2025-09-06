import { GameState } from './state.js';
default: return 2;
}
}


export function bonesReward(type) {
switch(type) {
case 'Villager': return 1;
case 'Squire': return 1;
case 'Hero': return 2;
case 'Knight': return 2;
case 'Kingsguard': return 5;
case 'Engineer': return 2;
default: return 1;
}
}


export function waveComposition(wave) {
// Simple composition; expand later
const list = [];
const add = (type, count)=>{ for(let i=0;i<count;i++) list.push(type); };
const base = 6 + Math.floor(wave * 0.6);
add('Villager', Math.max(4, base));
if (wave>=2) add('Squire', Math.floor(wave/2));
if (wave>=3) add('Knight', Math.floor((wave-1)/2));
if (wave>=4) add('Hero', Math.floor((wave-2)/3));
if (wave>=5) add('Engineer', Math.floor((wave-3)/3));
if (wave%5===0) add('Kingsguard', 1);
return list;
}
