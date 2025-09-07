// --- Ensure these imports exist (filenames all lowercase) ---
import { GameState, initState } from './state.js';
import { bindUI, renderUI, previewNextWave } from './ui.js';
import { draw } from './render.js';
import { recomputePath } from './pathing.js';
import { makeWave, tickCombat } from './combat.js';

// --- Globals (or keep inside a module scope) ---
let gs = null;
let ctx = null;
let rafId = 0;
let lastTs = 0;

// --- STARTUP ---
async function boot() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
  ctx = canvas.getContext('2d');

  gs = initState();                 // must set gs.mode = 'build' initially
  recomputePath(gs);                // compute a valid path on first load
  bindUI(gs);                       // wire buttons & checkboxes
  previewNextWave(gs);
  renderUI(gs);

  // Listen for the HTML custom event (exact name, on window)
  window.addEventListener('start-wave', onStartWave);

  // Optional: also wire the button directly, but keep start idempotent
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', onStartWave);

  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);
}

function onStartWave() {
  // Idempotent: only start from build mode and if not already starting
  if (!gs || gs.mode !== 'build') return;
  startWave();
}

function startWave() {
  // Defensive: ensure path exists before creating a wave
  if (!gs.path || gs.path.length === 0) {
    // Try to recompute once; if still empty, refuse to start.
    recomputePath(gs);
    if (!gs.path || gs.path.length === 0) return;
  }

  makeWave(gs);           // populate enemies for this wave
  gs.mode = 'combat';     // switch mode so tick drives combat
  gs.justStartedAt = performance.now(); // small debounce for auto-start loops
  renderUI(gs);
}

function endWave() {
  gs.mode = 'build';
  gs.lastWaveEndedAt = performance.now();
  previewNextWave(gs);
  renderUI(gs);
}

// --- MAIN TICK ---
function tick(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000); // cap 50ms
  lastTs = ts;

  if (gs.mode === 'combat') {
    const finished = tickCombat(dt, gs);   // returns true when wave ends
    if (finished) endWave();
  } else {
    // Auto-start check: only if enabled and not too soon
    if (gs.autoStart) {
      const now = performance.now();
      const guard =
        (!gs.justStartedAt || now - gs.justStartedAt > 200) &&
        (!gs.lastWaveEndedAt || now - gs.lastWaveEndedAt > 200);
      if (guard) startWave();
    }
  }

  draw(ctx, gs);
  renderUI(gs); // cheap UI refresh each frame
  rafId = requestAnimationFrame(tick);
}

// --- KICK ---
boot();
