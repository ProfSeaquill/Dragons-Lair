// main.js — boot, game loop, UI wiring, and safe combat integration
import * as state from './state.js';
// ...and use state.state.GameState in place of state.GameState
import { bindUI, UI } from './ui.js';
import * as render from './render.js';
import {
  recomputePath,
  stepEnemyInterpolated,
  updateEnemyDistance,
} from './pathing.js';

// ---------- Canvas / Context ----------
const canvas = document.getElementById('game');
if (!canvas) throw new Error('Canvas #game not found');
const ctx = canvas.getContext('2d');

// ---------- Combat (optional, dynamic) ----------
let Combat = {};
(async () => {
  try {
    Combat = await import('./combat.js');
  } catch (e) {
    console.warn('[main] combat.js not found or failed to load; running without it.', e);
  }
})();

// ---------- Boot ----------
function boot() {
  // Load previous save if UI triggers it; we still need initial distance field
  recomputePath(state.GameState);

  // Wire UI (buttons, edge build mode, upgrades)
  bindUI();

  // Listen for UI start signal (keeps main decoupled from UI internals)
  window.addEventListener('dl-start-wave', () => {
    startWave();
  });

  // Kick off loop
  lastT = performance.now();
  requestAnimationFrame(tick);
  // Tell boot overlay we're good
  window.dispatchEvent(new CustomEvent('dl-boot-ok'));
}

function startWave() {
  // Prefer explicit Combat.startWave, then fall back to spawnNextWave if present.
  if (typeof Combat.startWave === 'function') {
    Combat.startWave(state.GameState);
  } else if (typeof Combat.spawnNextWave === 'function') {
    Combat.spawnNextWave(state.GameState);
  } else if (typeof Combat.spawnWave === 'function') {
    Combat.spawnWave(state.GameState);
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
  // 1) Let Combat drive game logic if available
  // Try common names in order; they are all optional.
  if (typeof Combat.update === 'function') {
    Combat.update(state.GameState, dt);
  } else if (typeof Combat.tick === 'function') {
    Combat.tick(state.GameState, dt);
  } else if (typeof Combat.step === 'function') {
    Combat.step(state.GameState, dt);
  }

  // 2) Fallback enemy movement using maze-walk interpolation
  // Skip if combat is already advancing pixel positions for enemies.
  const enemies = state.GameState.enemies || [];
  for (const e of enemies) {
    // If combat is managing e (explicit flag), skip
    if (e.updateByCombat) continue;

    // If the enemy has cell coords (cx,cy) and a speed, we can move it smoothly.
    // If speed isn't set, treat 2.5 tiles/sec as a sane default for grunts.
    if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
      if (typeof e.pxPerSec !== 'number' && typeof e.speed !== 'number') {
        e.speed = e.speed || 2.5;
      }
      stepEnemyInterpolated(state.GameState, e, dt);
      updateEnemyDistance(state.GameState, e);
    }
  }

  // 3) Auto-start waves if enabled and field is clear
  if (state.GameState.autoStart) {
    const anyAlive = enemies && enemies.length > 0;
    // Small cooldown after starting a wave to avoid immediate re-trigger
    const cool = (performance.now() - waveJustStartedAt) < 600;
    if (!anyAlive && !cool) {
      startWave();
    }
  }

  // 4) Keep HUD in sync if gold/bones/hp might change outside UI handlers
  if (UI && typeof UI.refreshHUD === 'function') {
    UI.refreshHUD();
  }
}

// ---------- Go ----------
boot();
