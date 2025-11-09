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



// turns junctions OFF (A* only)
DL_NAV = { noJunctions: true }; console.log('Junctions OFF');


// turns junctions back ON
DL_NAV = { noJunctions: false }; console.log('Junctions ON');



// ===== DL DRAGON PROBE + OVERLAY =====
(function(){
  const S = window.state;
  if (!S || !S.GameState) { console.warn('No window.state.GameState'); return; }
  const gs = S.GameState;
  const t  = (S.GRID?.tile|0) || 32;

  function westBand(gs){
    const cells = S.dragonCells(gs);
    let minX=Infinity,minY=Infinity,maxY=-Infinity;
    for (const c of cells){ if(c.x<minX)minX=c.x; if(c.y<minY)minY=c.y; if(c.y>maxY)maxY=c.y; }
    return { bandX:(minX|0)-1, minY:(minY|0), maxY:(maxY|0) };
  }

  function adjOpen(cx,cy){
    for (const dc of S.dragonCells(gs)){
      const dx = dc.x - cx, dy = dc.y - cy;
      if (Math.abs(dx)+Math.abs(dy)!==1) continue;
      const side = dx===1?'E':dx===-1?'W':dy===1?'S':'N';
      if (S.isOpen(gs,cx,cy,side)) return true;
    }
    return false;
  }

  // ---- Console probe (prints a neat summary)
  window.dlProbeDragon = function(){
    const footprint = S.dragonCells(gs).map(c=>({x:c.x,y:c.y}));
    const mouth = S.dragonMouthCell(gs);
    const { bandX,minY,maxY } = westBand(gs);

    const rows = footprint.reduce((m,c)=>{ m.add(c.y); return m; }, new Set());
    const minX = Math.min(...footprint.map(c=>c.x));
    const maxX = Math.max(...footprint.map(c=>c.x));

    const enemies = (gs.enemies||[]).map(e=>{
      const cx = Number.isInteger(e.cx)?e.cx:(Number.isInteger(e.tileX)?e.tileX:Math.floor((e.x||0)/t));
      const cy = Number.isInteger(e.cy)?e.cy:(Number.isInteger(e.tileY)?e.tileY:Math.floor((e.y||0)/t));
      const inZone = (cx===bandX && cy>=minY && cy<=maxY);
      const atApproach = (cx===bandX-1 && cy>=minY && cy<=maxY);
      return {id:e.id,type:e.type,cx,cy,inZone,atApproach,adjOpen:adjOpen(cx,cy)};
    });

    const summary = {
      tileSize: t,
      dragonFootprint: {minX,maxX,rows:[...rows].sort((a,b)=>a-b), count: footprint.length},
      westBand: {bandX, span:[minY,maxY], tiles:(maxY-minY+1)},
      mouth,
      mouthRelative: { dx: mouth.x - minX, dy: mouth.y - Math.min(...rows) },
      mouthOnBand: (mouth.x===bandX && mouth.y>=minY && mouth.y<=maxY),
      enemiesNear: enemies.filter(e=>e.inZone||e.atApproach || Math.abs(e.cx-bandX)<=1)
    };

    console.table([
      { key:'tileSize', val: summary.tileSize },
      { key:'bandX',    val: summary.westBand.bandX },
      { key:'bandYspan',val: `${summary.westBand.span[0]}..${summary.westBand.span[1]}` },
      { key:'footprintCols', val:`${summary.dragonFootprint.minX}..${summary.dragonFootprint.maxX}` },
      { key:'footprintRows', val: summary.dragonFootprint.rows.join(',') },
      { key:'mouth',         val: `(${mouth.x},${mouth.y})` },
      { key:'mouthOnBand',   val: summary.mouthOnBand },
      { key:'mouth dx/dy',   val: `dx=${summary.mouthRelative.dx}, dy=${summary.mouthRelative.dy}` },
    ]);
    console.log('[dlProbeDragon] enemiesNear:', summary.enemiesNear);
    return summary; // so you can inspect it
  };

  // ---- Lightweight overlay to draw tiles
  let OV=null, CTX=null;
  function ensureOverlay(){
    if (OV) return;
    const gameCanvas = document.querySelector('canvas');
    const host = gameCanvas?.parentElement || document.body;
    OV = document.createElement('canvas');
    OV.width  = gameCanvas?.width  || (S.GRID.cols*t);
    OV.height = gameCanvas?.height || (S.GRID.rows*t);
    Object.assign(OV.style, {
      position:'absolute', left:(gameCanvas?.offsetLeft||0)+'px',
      top:(gameCanvas?.offsetTop||0)+'px', pointerEvents:'none', zIndex:9999
    });
    host.appendChild(OV);
    CTX = OV.getContext('2d');
  }
  function rectTile(x,y,stroke,fill,alpha=0.25){
    CTX.save();
    if (fill){ CTX.globalAlpha=alpha; CTX.fillStyle=fill; CTX.fillRect(x*t, y*t, t, t); }
    if (stroke){ CTX.globalAlpha=1; CTX.strokeStyle=stroke; CTX.lineWidth=2; CTX.strokeRect(x*t+1, y*t+1, t-2, t-2); }
    CTX.restore();
  }

  window.dlOverlayOn = function(){
    ensureOverlay();
    CTX.clearRect(0,0,OV.width,OV.height);

    // footprint = green
    for (const c of S.dragonCells(gs)) rectTile(c.x,c.y,'#00ff00','#00ff00',0.15);

    // west band = yellow
    const { bandX,minY,maxY } = westBand(gs);
    for (let y=minY; y<=maxY; y++) rectTile(bandX,y,'#ffd400','#ffd400',0.15);

    // mouth = blue
    const m = S.dragonMouthCell(gs);
    rectTile(m.x,m.y,'#00aaff',null,0.0);

    // enemies at approach vs in-zone
    for (const e of (gs.enemies||[])){
      const cx = Number.isInteger(e.cx)?e.cx:(Number.isInteger(e.tileX)?e.tileX:Math.floor((e.x||0)/t));
      const cy = Number.isInteger(e.cy)?e.cy:(Number.isInteger(e.tileY)?e.tileY:Math.floor((e.y||0)/t));
      const inZone = (cx===bandX && cy>=minY && cy<=maxY);
      const atApproach = (cx===bandX-1 && cy>=minY && cy<=maxY);
      if (inZone)      rectTile(cx,cy,'#ff0000','#ff0000',0.20);   // red = in zone
      else if (atApproach) rectTile(cx,cy,'#ff7f00','#ff7f00',0.15); // orange = one tile west
    }

    console.log('[dlOverlayOn] drawn: footprint(green), west band(yellow), mouth(blue), enemies red/orange.');
  };

  window.dlOverlayOff = function(){
    if (!OV) return;
    const ctx = CTX; ctx && ctx.clearRect(0,0,OV.width,OV.height);
  };

  console.log('Ready: dlProbeDragon(), dlOverlayOn(), dlOverlayOff()');
})();

