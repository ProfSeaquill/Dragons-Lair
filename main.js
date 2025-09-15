// main.js — boot, game loop, UI wiring, and combat integration (static import)

import * as state from './state.js';
import { bindUI, UI } from './ui.js';
import * as render from './render.js';
import {
  recomputePath,
  stepEnemyInterpolated,
  updateEnemyDistance,
} from './pathing.js';

// ---------- Combat (static import so Start Wave is always ready) ----------
import * as Combat from './combat.js';

// ---------- Canvas / Context ----------
const canvas = document.getElementById('game');
if (!canvas) throw new Error('Canvas #game not found');
const ctx = canvas.getContext('2d');

// ---------- Boot ----------
function boot() {
  // Ensure distance field exists
  recomputePath(state.GameState);

  // Wire UI (buttons, edge build mode, upgrades)
  bindUI();

  // Start button -> wave
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
  // Prefer explicit Combat.startWave, then fall back to spawnNextWave/spawnWave.
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
  if (typeof Combat.update === 'function') {
    Combat.update(state.GameState, dt);
  } else if (typeof Combat.tick === 'function') {
    Combat.tick(state.GameState, dt);
  } else if (typeof Combat.step === 'function') {
    Combat.step(state.GameState, dt);
  }

  // 2) Fallback enemy movement using maze-walk interpolation
  const enemies = state.GameState.enemies || [];
  for (const e of enemies) {
    if (e.updateByCombat) continue; // Combat owns this one

    if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
      if (typeof e.pxPerSec !== 'number' && typeof e.speed !== 'number') {
        e.speed = e.speed || 2.5; // tiles/sec default
      }
      stepEnemyInterpolated(state.GameState, e, dt);
      updateEnemyDistance(state.GameState, e);
    }
  }

  // 3) Auto-start waves if enabled and field is clear
  if (state.GameState.autoStart) {
    const anyAlive = enemies && enemies.length > 0;
    const cool = (performance.now() - waveJustStartedAt) < 600;
    if (!anyAlive && !cool) startWave();
  }

  // 4) Keep HUD in sync if gold/bones/hp might change outside UI handlers
  if (UI && typeof UI.refreshHUD === 'function') UI.refreshHUD();
}

// ---------- Go ----------
boot();
