import { GameState, COSTS, GRID, getDragonStats, saveState, loadState } from './state.js';
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
