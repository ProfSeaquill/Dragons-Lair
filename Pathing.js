import { GRID, ENTRY, EXIT, GameState } from './state.js';
const out = [];
let ck = currentKey;
while (ck) {
const n = nodes.get(ck);
out.push({c:n.c,r:n.r});
ck = came.get(ck);
}
return out.reverse();
}
open.delete(currentKey);


for(const nb of neighbors(current)){
const nk = key(nb);
nodes.set(nk, nb);
const tentative = (gScore.get(currentKey) ?? Infinity) + 1;
if (tentative < (gScore.get(nk) ?? Infinity)){
came.set(nk, currentKey);
gScore.set(nk, tentative);
fScore.set(nk, tentative + h(nb));
if (!open.has(nk)) open.add(nk);
}
}
}
return [];
}


export function recomputePath(){
GameState.path = aStar(ENTRY, EXIT);
return GameState.path.length>0;
}


export function toggleWall(c,r){
if (c===ENTRY.c && r===ENTRY.r) return false;
if (c===EXIT.c && r===EXIT.r) return false;
const val = GameState.grid[r][c];
GameState.grid[r][c] = val===0?1:0;
const ok = recomputePath();
if (!ok){
// revert if blocked
GameState.grid[r][c] = val;
recomputePath();
return false;
}
return true;
}
