// main.js — boot, game loop, UI wiring, and combat integration (named imports)
import * as Debug from './debugOverlay.js';
import { getCooldowns } from './combat.js';

import * as state from './state.js';
import { bindUI, UI } from './ui.js';
import * as render from './render.js';
import {
  recomputePath,
  stepEnemyInterpolated,
  updateEnemyDistance,
} from './pathing.js';
import { initLighting } from './lighting-webgl.js';
import { buyUpgrade } from './upgrades.js';

// ----- Combat (robust namespace import; tolerant of export name variants) -----
import * as combat from './combat.js';

async function loadConfigFiles() {
  const [tuning, enemies, waves, upgrades] = await Promise.all([
    fetch('./tuning.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('./enemies.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('./waves.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('./upgrades.json').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return { tuning, enemies, waves, upgrades };
}

// pick the per-frame update function (support update | tick | step)
const combatUpdate = (typeof combat.update === 'function')
  ? combat.update
  : (typeof combat.tick === 'function')
    ? combat.tick
    : (typeof combat.step === 'function')
      ? combat.step
      : null;

// pick start/spawn helpers (support multiple historical names)
const combatStartWave = combat.startWave ?? combat.spawnWave ?? null;
const combatSpawnWave = combat.spawnWave ?? combat.startWave ?? null;


// debug helper: expose state in window for console inspection
if (typeof window !== 'undefined') window.__STATE = state;

// Set up logical size
const logicalW = state.GRID.cols * state.GRID.tile;
const logicalH = state.GRID.rows * state.GRID.tile;

// Output canvas (WebGL)
const outCanvas = document.getElementById('game');
// Keep CSS at 1:1 logical pixels; WebGL will be sized exactly:
outCanvas.width = logicalW;
outCanvas.height = logicalH;
outCanvas.style.width = `${logicalW}px`;
outCanvas.style.height = `${logicalH}px`;

// Offscreen 2D scene buffer
const sceneCanvas = document.createElement('canvas');
sceneCanvas.width = logicalW;
sceneCanvas.height = logicalH;
const sceneCtx = sceneCanvas.getContext('2d', { alpha: true });
sceneCtx.imageSmoothingEnabled = false;

// Init post-process lighting
const lighting = initLighting(outCanvas, logicalW, logicalH);

// ---------- Lights (ENTRY/EXIT + path torches + enemy torches + dragon fire) ----------
function computeTorchLights(gs) {
  const t = state.GRID.tile;
  const lights = [];

  // Ensure the FIRST enemy of the current wave gets a torch (exactly once)
  if (!gs.__firstTorchGiven && Array.isArray(gs.enemies) && gs.enemies.length > 0) {
    const firstAlive = gs.enemies.find(en => en && !en.dead);
    if (firstAlive) {
      firstAlive.torchBearer = true;        // sticky flag on that enemy
      firstAlive.__torchWaveId = gs.__torchWaveId || 0;
      gs.__firstTorchGiven = true;
    }
  }

  // --- 1) Anchors: ENTRY + EXIT (dragon lair) ---
  const entry = { x: (state.ENTRY.x + 0.5) * t, y: (state.ENTRY.y + 0.5) * t };
  const exit  = { x: (state.EXIT.x  + 0.5) * t, y: (state.EXIT.y  + 0.5) * t };

  // Make dragon/lair pool bigger per your request
  lights.push({ x: entry.x, y: entry.y, r: t * 1.2, color: [1.00, 0.85, 0.55] });
  lights.push({ x: exit.x,  y: exit.y,  r: t * 1.9, color: [1.00, 0.75, 0.45] });

  // --- Enemy-carried torches (sticky; die with the carrier; special roles always carry) ---
  if (Array.isArray(gs.enemies)) {
    for (const e of gs.enemies) {
      if (!ensureTorchBearer(e, gs)) continue;
      const p = enemyPixel(e, t);
      if (!p) continue;
      lights.push({
        x: p.x,
        y: p.y,
        r: t * 0.85,
        color: [1.00, 0.86, 0.58],
      });
    }
  }

  // --- Dragon mouth fire light that follows the animation ---
  const fx = gs.dragonFX;
  if (fx && fx.attacking && fx.dur > 0) {
    // Mouth position (match your render.js offsets)
    const mouth = { x: exit.x + t * 0.60, y: exit.y - t * 0.15 };

    // Progress 0..1 across the breath animation
    const progress = Math.max(0, Math.min(1, fx.t / fx.dur));

    // How far the light extends away from the mouth (in tiles)
    // Starts short, grows with progress; tweak the 0.2 and 1.4 to taste
    const maxTiles = 0.2 + 1.4 * progress;

    // Direction: if your dragon breath points RIGHT, dir = (1,0).
    // Change to (-1,0) or (0,±1) if your art faces other directions.
    const dirX = 1, dirY = 0;

    // Place a small chain of lights along the breath
    const segments = 3; // 3 points reads well without being noisy
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;                // 0..1 along the beam
      const dist = f * maxTiles * t;         // pixels from mouth
      const px = mouth.x + dirX * dist;
      const py = mouth.y + dirY * dist;

      // Shrink radius farther from mouth; keep lights tiny
      const r = t * (i === 0 ? 1.2 : 0.85 * (1.0 - 0.25 * f));

      // Warm, slightly dimmer as it travels
      const col = [1.00, 0.70 - 0.10 * f, 0.32 - 0.08 * f];

      lights.push({ x: px, y: py, r, color: col });
    }
  }

  // IMPORTANT: cap to shader limit
  return lights.slice(0, 16);
}

// --- Helpers used above ---

// Follow the steepest-ascent of distFromEntry to build a quick path from (sx,sy) to (tx,ty)
function shortestPathCells(gs, sx, sy, tx, ty) {
  const path = [];
  const dist = gs.distFromEntry;
  if (!dist || !isFinite(dist?.[sy]?.[sx])) return path;

  let x = sx, y = sy, guard = state.GRID.cols * state.GRID.rows + 5;
  path.push({ x, y });

  while (guard-- > 0 && !(x === tx && y === ty)) {
    let best = null, bestD = -Infinity;
    const cand = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
    ];
    for (const [nx, ny] of cand) {
      if (!state.inBounds(nx, ny)) continue;
      const d = dist?.[ny]?.[nx];
      if (isFinite(d) && d > bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    if (!best) break;
    x = best.x; y = best.y;
    path.push({ x, y });
    // safety: avoid loops
    if (path.length > guard) break;
  }
  return path;
}

function enemyPixel(e, t) {
  if (typeof e.x === 'number' && typeof e.y === 'number') return { x: e.x, y: e.y };
  if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
    return { x: (e.cx + 0.5) * t, y: (e.cy + 0.5) * t };
  }
  return null;
}

function ensureTorchBearer(e, gs) {
  // Already chosen? stay chosen.
  if (e.torchBearer === true) return true;

  // Always torch for these types
  if (e.type === 'hero' || e.type === 'kingsguard' || e.type === 'boss') {
    e.torchBearer = true;
    return true;
  }

  // Default: not a carrier unless explicitly picked (see step 3)
  return false;
}

// Main frame
let lastT = 0;
let waveJustStartedAt = 0;

function frame(now) {
  if (!lastT) lastT = now;
  const dt = Math.max(0, (now - lastT)) / 1000;
  lastT = now;

  // 1) update game state
  update(dt);

  // 2) draw scene into offscreen 2D
  sceneCtx.globalCompositeOperation = 'source-over';
  sceneCtx.globalAlpha = 1;
  if ('filter' in sceneCtx) sceneCtx.filter = 'none';
  render.draw(sceneCtx, state.GameState);

  Debug.markFrame();
  Debug.tick({
  
});

  // 3) build lights & present via WebGL
 // computeTorchLights already slices to 16; no need to slice again
const lights = computeTorchLights(state.GameState);
const ambient = 0.65;
lighting.render(sceneCanvas, lights, ambient);

  requestAnimationFrame(frame);
}

// ---------- Boot ----------
function boot() {
  recomputePath(state.GameState);

  // Bind all CustomEvent listeners before UI wiring
  window.addEventListener('dl-start-wave', () => { startWave(); });
    
  lastT = performance.now();
  requestAnimationFrame(frame);     // <- use frame, not tick

  window.dispatchEvent(new CustomEvent('dl-boot-ok'));

  Debug.init();

  window.addEventListener('dl-heal', () => {
  const { healed, reason } = state.healDragon(state.GameState);
  if (healed > 0) {
    UI.refreshHUD?.();
    UI.tell?.(`Healed ${healed} HP`);
  } else {
    UI.tell?.(reason === 'full' ? 'HP already full' : 'Not enough bones');
  }
});

window.addEventListener('dl-auto-start', (e) => {
  state.GameState.autoStart = !!e.detail;
  UI.refreshHUD?.();
  UI.tell?.(state.GameState.autoStart ? 'Auto-start ON' : 'Auto-start OFF');
});

window.addEventListener('dl-save', () => {
  const ok = state.saveState(state.GameState);
  UI.tell?.(ok ? 'Saved' : 'Save failed', ok ? '#8f8' : '#f88');
});

window.addEventListener('dl-load', () => {
  if (state.loadState()) {
    recomputePath(state.GameState);
    UI.refreshHUD?.();
    UI.tell?.('Loaded', '#8f8');
  } else {
    UI.tell?.('No save found', '#f88');
  }
});

window.addEventListener('dl-upgrade-buy', (e) => {
  const id = e.detail?.id;
  if (!id) return;
  const ok = buyUpgrade(state.GameState, id);
  if (ok) {
    // HUD refresh also triggers upgrade button re-eval when gold changes
    UI.refreshHUD?.();
    UI.tell?.(`Upgraded ${id}`);
  } else {
    UI.tell?.('Not enough gold');
  }
});

// Wire UI after listeners are set
bindUI();
  
  loadConfigFiles()
  .then(cfg => {
    state.applyConfig(state.GameState, cfg);
    UI.renderUpgradesPanel?.();
    recomputePath(state.GameState);   // safe: if waves/enemies affect path calc later
    UI.refreshHUD?.();
    UI.tell?.('Config loaded');
  })
  .catch(err => console.warn('Config load failed, using defaults', err));
}

function startWave() {
  const gs = state.GameState;
  gs.__torchWaveId = (gs.__torchWaveId || 0) + 1;
  gs.__firstTorchGiven = false;
  if (typeof combatStartWave === 'function') {
    combatStartWave(state.GameState);
  } else if (typeof combatSpawnWave === 'function') {
    combatSpawnWave(state.GameState);
  }
  waveJustStartedAt = performance.now();
}

function update(dt) {
  const gs = state.GameState;

  // --- Ensure containers exist early (prevents .filter / for-of crashes) ---
  if (!Array.isArray(gs.enemies)) gs.enemies = [];
  if (!Array.isArray(gs.effects)) gs.effects = [];

  // --- Game Over guard ---
  if ((gs.dragonHP | 0) <= 0) {
    if (!gs.gameOver) {
      gs.gameOver = true;
      gs.autoStart = false;

      // stop any current action
      gs.enemies.length = 0;
      gs.effects.length = 0;

      // disable Start button
      const startBtn = document.getElementById('startBtn');
      if (startBtn) startBtn.disabled = true;

      // on-screen notice
      if (UI && typeof UI.tell === 'function') {
        UI.tell('💀 Game Over! Your lair was overrun. Load a save or refresh to try again.', '#ff6b6b');
      }
    }
    // Keep HUD responsive but freeze gameplay updates
    if (UI && typeof UI.refreshHUD === 'function') UI.refreshHUD();
    return;
  }
  // --- end Game Over guard ---

  // 1) Let Combat drive game logic if available
  if (typeof combatUpdate === 'function') {
   combatUpdate(gs, dt);
}


// 2) Fallback enemy movement using interpolated center-to-center steps
for (const enemy of gs.enemies) {
  if (enemy.updateByCombat) continue;
  // NEW: if the unit is currently attacking the dragon, don't move it
  if (enemy.pausedForAttack) continue;

  if (Number.isInteger(enemy.cx) && Number.isInteger(enemy.cy)) {
    if (typeof enemy.pxPerSec !== 'number' && typeof enemy.speed !== 'number') {
      enemy.speed = enemy.speed || 2.5;
    }
    stepEnemyInterpolated(gs, enemy, dt);
    updateEnemyDistance(gs, enemy);
  }
}

  // 2b) Dragon fire animation FX timer (visual only; optional)
  const dfx = gs.dragonFX;
  if (dfx && dfx.attacking) {
    dfx.t += dt;
    if (dfx.t >= dfx.dur) {
      dfx.attacking = false;
      dfx.t = 0;
    }
  }

  // 2c) Advance flame-wave effects (if any) and clean up dead ones
  for (const eff of gs.effects) {
    if (eff.type !== 'flameWave') continue;
    eff.t += dt;
    const head = Math.floor(eff.t * (eff.tilesPerSec || 12));
    eff.headIdx = Math.min((eff.path?.length ?? 0) - 1, head);
    if (eff.t > (eff.dur || 0.7)) eff.dead = true;
  }
  gs.effects = gs.effects.filter(eff => !eff.dead);

  // 3) Auto-start waves if enabled and field is clear
  if (gs.autoStart) {
    const anyAlive = gs.enemies.length > 0;
    const cool = (performance.now() - waveJustStartedAt) < 600; // small cooldown after starting
    if (!anyAlive && !cool) startWave();
  }

  // 4) HUD sync
  if (UI && typeof UI.refreshHUD === 'function') UI.refreshHUD();

  // --- Effects update (tick & cleanup) for non-flameWave effects only
  {
    const arr = gs.effects || [];
    for (const fx of arr) {
      if (!fx || fx.type === 'flameWave') continue; // skip; handled in 2c
      if (fx.t == null) fx.t = 0;
      if (fx.dur == null) fx.dur = 0.6;
      fx.t += dt;
      if (fx.t >= fx.dur) fx.dead = true;
    }
    gs.effects = arr.filter(fx => !fx?.dead);
  }
}
// ---------- Go ----------
boot();
