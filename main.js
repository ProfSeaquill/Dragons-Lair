// main.js — Dragon’s Lair bootstrap & game loop (single-file entry)
//
// Goals of this revision:
// 1) Listen for the exact CustomEvent('start-wave') the HTML dispatches.
// 2) Allow the Start button to be wired here too without double-starts.
// 3) Ensure we only start from build mode and only when a valid path exists.
// 4) Make auto-start reliable with a tiny debounce.
// 5) Keep UI refreshed every frame; keep loop ~60fps.

import * as state from './state.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as pathing from './pathing.js';
import * as combat from './combat.js';

// ---- Internal module state ----
let gs = null;                 // game state object
let ctx = null;                // 2D canvas context
let rafId = 0;                 // requestAnimationFrame id
let lastTs = 0;                // last tick timestamp

// ---- Boot sequence ----
function boot() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
  if (!canvas) {
    console.error('[DL] <canvas id="game"> not found');
    return;
  }
  ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('[DL] 2D context not available');
    return;
  }

  // Initialize state (support either named or default factory patterns).
  gs = (state.initState ? state.initState() : (state.GameState ? state.GameState() : null));
  if (!gs) {
    // Fallback minimal scaffold to avoid hard-crash if state exports changed.
    gs = { mode: 'build', wave: 1, gold: 0, bones: 0, autoStart: false, enemies: [], path: null };
    console.warn('[DL] Using fallback GameState scaffold — check state.js exports');
  }

  // Ensure sane startup invariants
  if (gs.mode !== 'combat') gs.mode = 'build';
  if (typeof gs.autoStart !== 'boolean') gs.autoStart = false;

  // Compute initial path at least once (so starts don’t silently fail)
  if (pathing.recomputePath) pathing.recomputePath(gs);

  // Wire the UI once
  if (ui.bindUI) ui.bindUI(gs);
  if (ui.previewNextWave) ui.previewNextWave(gs);
  if (ui.renderUI) ui.renderUI(gs);

  // Listen for the exact custom event name emitted by index.html
  window.addEventListener('start-wave', onStartWave);

  // Also wire the button directly (idempotent guard prevents double-starts)
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', onStartWave);

  // Kick the loop
  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);

  // Expose for quick debugging from DevTools
  // (e.g., window.__GS__.autoStart = true)
  window.__GS__ = gs;
  console.log('[DL] boot complete');
}

// ---- Start / End wave control ----
function onStartWave() {
  if (!gs) return;

  // Only from build mode; ignore if already in combat or transitioning
  if (gs.mode !== 'build') return;

  startWave();
}

function startWave() {
  // Defensive: ensure we have a valid path
  if (!gs.path || !Array.isArray(gs.path) || gs.path.length === 0) {
    if (pathing.recomputePath) pathing.recomputePath(gs);
    if (!gs.path || !Array.isArray(gs.path) || gs.path.length === 0) {
      // Still no path; refuse to start silently (UI should already warn on placement)
      console.warn('[DL] startWave blocked: no valid path');
      return;
    }
  }

  if (combat.makeWave) combat.makeWave(gs);
  gs.mode = 'combat';

  // tiny debounce anchors for auto-start logic
  gs.justStartedAt = performance.now();

  if (ui.renderUI) ui.renderUI(gs);
}

function endWave() {
  // Return to build mode and prep next preview
  gs.mode = 'build';
  gs.lastWaveEndedAt = performance.now();

  if (ui.previewNextWave) ui.previewNextWave(gs);
  if (ui.renderUI) ui.renderUI(gs);
}

// ---- Main loop ----
function tick(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000); // cap 50ms to keep sim stable
  lastTs = ts;

  if (gs.mode === 'combat') {
    // tickCombat should return true when the wave finishes
    let finished = false;
    if (combat.tickCombat) {
      try {
        finished = !!combat.tickCombat(dt, gs);
      } catch (e) {
        console.error('[DL] tickCombat error:', e);
      }
    }

    if (finished) endWave();
  } else {
    // Build mode: respect auto-start if enabled
    if (gs.autoStart) {
      const now = performance.now();
      const okSinceStart = !gs.justStartedAt || (now - gs.justStartedAt > 200);
      const okSinceEnd = !gs.lastWaveEndedAt || (now - gs.lastWaveEndedAt > 200);
      if (okSinceStart && okSinceEnd) {
        startWave();
      }
    }
  }

  // Render frame & lightweight UI refresh
  if (render.draw) render.draw(ctx, gs);
  if (ui.renderUI) ui.renderUI(gs);

  rafId = requestAnimationFrame(tick);
}

// ---- Hot-reload guard (optional) ----
if (import.meta && import.meta.hot && import.meta.hot.dispose) {
  import.meta.hot.dispose(() => cancelAnimationFrame(rafId));
}

// ---- Kick ----
boot();
