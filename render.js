import { GRID, GameState, ENTRY, EXIT, getDragonStats } from './state.js';
g.fillStyle = '#e46e2e';
g.beginPath();
g.arc(EXIT.c*GRID.tile+GRID.tile/2, EXIT.r*GRID.tile+GRID.tile/2, GRID.tile*0.35, 0, Math.PI*2);
g.fill();


// Enemies
for (const e of GameState.enemies){
if (e.pathIndex<0 || e.hp<=0) continue;
const node = GameState.path[Math.min(e.pathIndex, GameState.path.length-1)];
const x = node.c*GRID.tile + GRID.tile/2;
const y = node.r*GRID.tile + GRID.tile/2;
// color by type
const color = {
Villager:'#b3c1d1', Squire:'#92a7ff', Hero:'#ffd76a', Knight:'#8dd18d', Kingsguard:'#ff7e7e', Engineer:'#ffad66'
}[e.type] || '#ddd';
g.fillStyle = color;
g.beginPath(); g.arc(x,y, GRID.tile*0.25, 0, Math.PI*2); g.fill();


// health bar
g.fillStyle = '#400';
g.fillRect(x-16,y-18,32,5);
g.fillStyle = '#e44';
g.fillRect(x-16,y-18, Math.max(0, 32*(e.hp/e.maxHP)),5);


// special effects
if (e.type==='Hero' && e.shieldUp){
g.strokeStyle = 'rgba(255, 235, 120, 0.8)'; g.lineWidth=2; g.beginPath(); g.arc(x,y, GRID.tile*0.30, 0, Math.PI*2); g.stroke();
}
if (e.burning.t>0){
g.strokeStyle = 'rgba(255, 120, 50, 0.7)'; g.lineWidth=1; g.beginPath(); g.arc(x,y, GRID.tile*0.33, 0, Math.PI*2); g.stroke();
}
}


// Breath visualization
const ds = getDragonStats();
const maxIndex = Math.max(0, ...GameState.enemies.filter(e=>e.pathIndex>=0).map(e=>e.pathIndex));
const minIndex = Math.max(0, maxIndex - ds.reach);
const tiles = GameState.path.slice(minIndex, maxIndex+1);
for (const p of tiles){
g.fillStyle = 'rgba(255,120,50,0.15)';
g.fillRect(p.c*GRID.tile, p.r*GRID.tile, GRID.tile-1, GRID.tile-1);
}
}
