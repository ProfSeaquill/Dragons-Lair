// ui.js
import { GameState, COSTS, GRID, getDragonStats, saveState, loadState } from './state.js';
import { getUpgradeInfo, buyUpgrade } from './upgrades.js';
import { toggleWall } from './pathing.js';

const $ = (id)=> document.getElementById(id);

export function bindUI(){
  const startBtn = $('#startBtn');
  const autoStart = $('#autoStart');
  const saveBtn = $('#saveBtn');
  const loadBtn = $('#loadBtn');
  const canvas = $('#game');

  if (!startBtn) console.warn('[DL] Missing #startBtn in index.html');
  if (!autoStart) console.warn('[DL] Missing #autoStart in index.html');
  if (!saveBtn) console.warn('[DL] Missing #saveBtn in index.html');
  if (!loadBtn) console.warn('[DL] Missing #loadBtn in index.html');
  if (!canvas) console.warn('[DL] Missing #game <canvas> in index.html');

  if (startBtn) startBtn.onclick = ()=> window.dispatchEvent(new CustomEvent('start-wave'));
  if (autoStart) autoStart.onchange = (e)=> GameState.autoStart = e.target.checked;
  if (saveBtn) saveBtn.onclick = ()=>{ saveState(); toast('Saved!'); };
  if (loadBtn) loadBtn.onclick = ()=>{ const ok = loadState(); toast(ok? 'Loaded!' : 'No save found.'); };

  if (!canvas) return;

  canvas.addEventListener('contextmenu', (e)=> e.preventDefault());
  canvas.addEventListener('mousedown', (e)=>{
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    const c = Math.floor(x/GRID.tile); const r = Math.floor(y/GRID.tile);
    const isRight = e.button===2;

    if (isRight){
      if (GameState.grid[r][c]===1){
        GameState.grid[r][c]=0;
        GameState.bones += COSTS.wallRefund;
        window.dispatchEvent(new CustomEvent('grid-changed'));
        toast('Removed wall (+25 bones)');
      }
      return;
    }

    if (GameState.grid[r][c]===0){
      if (GameState.bones>=COSTS.wall){
        const ok = toggleWall(c,r);
        if (ok){ GameState.bones -= COSTS.wall; toast('Placed wall (-50 bones)'); }
        else { toast('Cannot fully block the path'); }
      } else { toast('Not enough bones'); }
    }
  });
}

export function renderUI(){
  $('#gold').textContent = Math.floor(GameState.gold);
  $('#bones').textContent = Math.floor(GameState.bones);
  $('#wave').textContent = GameState.wave;
  $('#dragonHP').textContent = Math.max(0, Math.floor(GameState.dragon.hp));

  const list = getUpgradeInfo();
  const node = $('#upgrades');
  node.innerHTML = '';
  for (const u of list){
    const div = document.createElement('div'); div.className='uRow';

    const stat = getDragonStats();
    const current = {
      power: stat.power,
      reach: stat.reach,
      speed: stat.speed,
      burn:  stat.burn
    }[u.key];

    div.innerHTML = `<div><strong>${u.name}</strong><br/><small>Lvl ${u.lvl} → ${u.lvl+1} | Cost ${u.cost}g</small><br/><small>Current: ${current}</small></div>`;
    const btn = document.createElement('button'); btn.className='btn'; btn.textContent='Buy';
    btn.disabled = (u.lvl>=u.max) || (GameState.gold<u.cost);
    btn.onclick = ()=>{ if (buyUpgrade(u.key)) toast(`${u.name} upgraded!`); };
    div.appendChild(btn);
    node.appendChild(div);
  }
}

export function previewNextWave(html){
  $('#preview').innerHTML = html;
}

let toastTimer=null;
export function toast(msg){
  const el = $('#msg'); el.textContent = msg; clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.textContent=''; }, 2000);
}
