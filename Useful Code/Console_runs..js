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
