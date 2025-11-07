// Confirms that braces are balanced
(async () => {
  const res = await fetch('./pathing/index.js');     // replace file name
  const txt = await res.text();
  let bal = 0, line = 1, col = 0;
  for (let i=0;i<txt.length;i++) {
    const ch = txt[i];
    if (ch === '\n') { line++; col = 0; continue; }
    col++;
    if (ch === '{') bal++;
    if (ch === '}') { bal--; if (bal < 0) { console.log('First extra } at', line, col); break; } }
  }
  console.log('Final balance', bal, ' (0 is good)');
})();


// returns enemy presence and positions
(() => {
  const gs = window.state?.GameState;
  if (!gs) return console.warn('No GameState');
  const t = window.state?.GRID?.tile || 32;
  const snapshot = (gs.enemies||[]).map(e => ({
    id:e.id, type:e.type,
    cx:e.cx, cy:e.cy,
    x:e.x, y:e.y,
    tunn:!!e.tunneling,
    hasSprite: !!(e && (e.sprite || e.spriteKey || e.img))
  }));
  console.table(snapshot);
})();
