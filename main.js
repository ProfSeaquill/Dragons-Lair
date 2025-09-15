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

  // --- Effects update (tick & cleanup)
{
  const arr = state.GameState.effects || [];
  for (const fx of arr) {
    if (!fx) continue;
    if (fx.t == null) fx.t = 0;
    if (fx.dur == null) fx.dur = 0.6;

    fx.t += dt;
    if (fx.t >= fx.dur) fx.dead = true;
  }
  state.GameState.effects = arr.filter(fx => !fx.dead);
}
}

// ---------- Go ----------
boot();
