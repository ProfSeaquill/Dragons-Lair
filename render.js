import { state } from './state.js';

export function createRenderer(canvas){
  const ctx = canvas.getContext('2d');
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const g = ctx.createLinearGradient(0,0,0,canvas.height);
    g.addColorStop(0,'#0c0f1e'); g.addColorStop(1,'#0b0e19');
    ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);

    // Dragon (left)
    ctx.fillStyle = '#26304f';
    ctx.beginPath(); ctx.arc(90, canvas.height-90, 60, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#6ee7ff';
    ctx.beginPath(); ctx.arc(90, canvas.height-90, 30, 0, Math.PI*2); ctx.fill();

    // Fire beam
    if(state.inWave){
      ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(140, canvas.height-110); ctx.lineTo(460, 120); ctx.stroke();
    }

    // Enemy (right)
    if(state.inWave){
      ctx.fillStyle = state.isBoss ? '#4f2630' : '#2a354f';
      ctx.beginPath(); ctx.arc(540, 120, state.isBoss?45:30, 0, Math.PI*2); ctx.fill();
      const w = 420, x=140, y=24, h=18;
      ctx.fillStyle = '#141a2e'; ctx.fillRect(x,y,w,h);
      const pct = Math.max(0, state.enemyHP)/state.enemyMaxHP;
      ctx.fillStyle = state.isBoss ? '#ff6b6b' : '#7cffa5';
      ctx.fillRect(x+2,y+2,(w-4)*pct,h-4);
      ctx.fillStyle = '#cdd7ff';
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(`${state.isBoss?'BOSS ':''}HP: ${Math.ceil(state.enemyHP)} / ${state.enemyMaxHP}`, x+8, y+14);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
