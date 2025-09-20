// main.js — boot, game loop, UI wiring, and combat integration (named imports)

import * as state from './state.js';
import { bindUI, UI } from './ui.js';
import * as render from './render.js';
import {
  recomputePath,
  stepEnemyInterpolated,
  updateEnemyDistance,
} from './pathing.js';
import { initLighting } from './lighting-webgl.js';

// ----- Combat (named imports; avoids "import * as ..." form) -----
import {
  startWave as combatStartWave,
  spawnNextWave as combatSpawnNextWave,
  spawnWave as combatSpawnWave,
  update as combatUpdate,
  tick as combatTick,   // alias exported in combat.js; ok if unused
  step as combatStep,   // alias exported in combat.js; ok if unused
} from './combat.js';

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

// Torch list (ENTRY/EXIT + sparse corridor torches)
function computeTorchLights(gs) {
  const lights = [];
  const t = state.GRID.tile;

  // ENTRY / EXIT anchors
  const entry = { x: (state.ENTRY.x + 0.5) * t, y: (state.ENTRY.y + 0.5) * t };
  const exit  = { x: (state.EXIT.x  + 0.5) * t, y: (state.EXIT.y  + 0.5) * t };
  lights.push({ x: entry.x, y: entry.y, r: t*1.2, color:[1.0,0.85,0.55] });
  lights.push({ x: exit.x,  y: exit.y,  r: t*1.4, color:[1.0,0.75,0.45] });

  // Sparse torches along straight corridors, every 3rd tile
  for (let y = 0; y < state.GRID.rows; y++) {
    for (let x = 0; x < state.GRID.cols; x++) {
      const n = state.isOpen(gs, x, y, 'N');
      const e = state.isOpen(gs, x, y, 'E');
      const s = state.isOpen(gs, x, y, 'S');
      const w = state.isOpen(gs, x, y, 'W');
      const opens = (n?1:0)+(e?1:0)+(s?1:0)+(w?1:0);
      if (opens === 0) continue;

      const straight = (n&&s && !e && !w) || (e&&w && !n && !s);
      const junction = opens >= 3;

      if (junction || (straight && ((x + y) % 3 === 0))) {
        lights.push({ x: (x+0.5)*t, y: (y+0.5)*t, r: t*1.0, color:[1.0,0.82,0.5] });
      }
    }
  }
  // Cap to 64 (shader limit)
  return lights.slice(0, 64);
}

// Main frame
function frame(ts) {
  const gs = state.GameState;

  // 1) Draw the scene into offscreen 2D
  sceneCtx.globalCompositeOperation = 'source-over';
  sceneCtx.globalAlpha = 1;
  if ('filter' in sceneCtx) sceneCtx.filter = 'none';
  render.draw(sceneCtx, gs);

  // 2) Build lights & present via WebGL
  const lights = computeTorchLights(gs);
  const ambient = 0.65; // 0.60–0.75 is a good “cave” range
  lighting.render(sceneCanvas, lights, ambient);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Boot ----------
function boot() {
  recomputePath(state.GameState);
  bindUI();

  window.addEventListener('dl-start-wave', () => {
    startWave();
  });

  lastT = performance.now();
  requestAnimationFrame(tick);

  window.dispatchEvent(new CustomEvent('dl-boot-ok'));
}

function startWave() {
  if (typeof combatStartWave === 'function') {
    combatStartWave(state.GameState);
  } else if (typeof combatSpawnNextWave === 'function') {
    combatSpawnNextWave(state.GameState);
  } else if (typeof combatSpawnWave === 'function') {
    combatSpawnWave(state.GameState);
  }
  waveJustStartedAt = performance.now();
}

// ---------- Loop ----------
let lastT = 0;
let waveJustStartedAt = 0;

function tick(now) {
  const dtMs = Math.max(0, now - lastT);
  lastT = now;
  const dt = dtMs / 1000;

  update(dt);
  render.draw(ctx, state.GameState);

  requestAnimationFrame(tick);
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
  } else if (typeof combatTick === 'function') {
    combatTick(gs, dt);
  } else if (typeof combatStep === 'function') {
    combatStep(gs, dt);
  }

  // 2) Fallback enemy movement using interpolated center-to-center steps
  //    (Skip enemies explicitly owned by combat)
  for (const enemy of gs.enemies) {
    if (enemy.updateByCombat) continue;

    if (Number.isInteger(enemy.cx) && Number.isInteger(enemy.cy)) {
      if (typeof enemy.pxPerSec !== 'number' && typeof enemy.speed !== 'number') {
        enemy.speed = enemy.speed || 2.5; // sane default tiles/sec
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
