// main.js — boot, game loop, UI wiring, and combat integration (named imports)

import * as state from './state.js';
import { bindUI, UI } from './ui.js';
import * as render from './render.js';
import {
  recomputePath,
  stepEnemyInterpolated,
  updateEnemyDistance,
} from './pathing.js';

// ----- Combat (named imports; avoids "import * as ..." form) -----
import {
  startWave as combatStartWave,
  spawnNextWave as combatSpawnNextWave,
  spawnWave as combatSpawnWave,
  update as combatUpdate,
  tick as combatTick,   // alias exported in combat.js; ok if unused
  step as combatStep,   // alias exported in combat.js; ok if unused
} from './combat.js';

// ---------- Canvas / Context ----------
const canvas = document.getElementById('game');
if (!canvas) throw new Error('Canvas #game not found');
const ctx = canvas.getContext('2d');

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
  // --- Game Over guard ---
  const gs = state.GameState;
  if (gs.dragonHP <= 0) {
    if (!gs.gameOver) {
      gs.gameOver = true;
      gs.autoStart = false;
      // stop any current action
      if (Array.isArray(gs.enemies)) gs.enemies.length = 0;
      if (Array.isArray(gs.effects)) gs.effects.length = 0;
      // disable the Start button
      const startBtn = document.getElementById('startBtn');
      if (startBtn) startBtn.disabled = true;
      // on-screen notice
      if (UI && typeof UI.tell === 'function') {
        UI.tell('💀 Game Over! Your lair was overrun. Load a save or refresh to try again.', '#ff6b6b');
      }
    }
    // Freeze gameplay updates while still letting render() draw the scene/HUD
    if (UI && typeof UI.refreshHUD === 'function') UI.refreshHUD();
    return;
  }
  // --- end Game Over guard ---
  // 1) Let Combat drive game logic if available
  if (typeof combatUpdate === 'function') {
    combatUpdate(state.GameState, dt);
  } else if (typeof combatTick === 'function') {
    combatTick(state.GameState, dt);
  } else if (typeof combatStep === 'function') {
    combatStep(state.GameState, dt);
  }

  // 2) Fallback enemy movement using maze-walk interpolation
  const enemies = state.GameState.enemies || [];
  for (const e of enemies) {
    if (e.updateByCombat) continue;

    if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
      if (typeof e.pxPerSec !== 'number' && typeof e.speed !== 'number') {
        e.speed = e.speed || 2.5;
      }
      stepEnemyInterpolated(state.GameState, e, dt);
      updateEnemyDistance(state.GameState, e);
    }
  }

  // 2b) Dragon fire animation FX timer (visual only)
const fx = state.GameState.dragonFX;
if (fx && fx.attacking) {
  fx.t += dt;
  if (fx.t >= fx.dur) {
    fx.attacking = false; // animation finished
    fx.t = 0;
  }
}
  
  // 3) Auto-start waves if enabled and field is clear
  if (state.GameState.autoStart) {
    const anyAlive = enemies && enemies.length > 0;
    const cool = (performance.now() - waveJustStartedAt) < 600;
    if (!anyAlive && !cool) startWave();
  }

  // 4) HUD sync
  if (UI && typeof UI.refreshHUD === 'function') UI.refreshHUD();
}

// ---------- Go ----------
boot();
