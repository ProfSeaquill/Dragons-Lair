// main.js — Dragon’s Lair bootstrap & game loop (fixed wave increment)

import * as state from './state.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as pathing from './pathing.js';
import * as combat from './combat.js';

let gs = null;
let ctx = null;
let rafId = 0;
let lastTs = 0;

function boot() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
  if (!canvas) { console.error('[DL] <canvas id="game"> not found'); return; }
  ctx = canvas.getContext('2d');
  if (!ctx) { console.error('[DL] 2D context not available'); return; }

  gs = (state.initState ? state.initState() : (state.GameState ? state.GameState() : null));
  if (!gs) gs = { mode: 'build', wave: 1, gold: 0, bones: 0, autoStart: false, enemies: [], path: [] };

  if (gs.mode !== 'combat') gs.mode = 'build';
  if (typeof gs.autoStart !== 'boolean') gs.autoStart = false;

  pathing.recomputePath?.(gs);

  ui.bindUI?.(gs);
  ui.previewNextWave?.(gs);
  ui.renderUI?.(gs);

  // Button wiring (no inline fallback needed)
  document.getElementById('startBtn')?.addEventListener('click', onStartWave);

  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);

  window.__GS__ = gs;
  console.log('[DL] boot complete');
}

function onStartWave() {
  if (!gs || gs.mode !== 'build') return;
  startWave();
}

function startWave() {
  if (!gs.path || !gs.path.length) {
    pathing.recomputePath?.(gs);
    if (!gs.path || !gs.path.length) { console.warn('[DL] startWave blocked: no valid path'); return; }
  }
  combat.makeWave?.(gs);
  gs.mode = 'combat';
  gs.justStartedAt = performance.now();
  ui.renderUI?.(gs);
}

function endWave() {
  // ✅ Advance wave number here
  gs.wave = (gs.wave | 0) + 1;
  gs.mode = 'build';
  gs.lastWaveEndedAt = performance.now();
  // Heal the dragon between waves (based on regen ladder)
  const ds = getDragonStats(gs);
  const heal = ds.regenPerWave ?? 10;
  const d = gs.dragon;
  d.hp = Math.min(d.hpMax, d.hp + heal);
  ui.toast?.(`Dragon healed +${heal} HP`);
  // Advance wave & return to build
  gs.wave = (gs.wave | 0) + 1;
  gs.mode = 'build';
  gs.lastWaveEndedAt = performance.now();
  
  ui.previewNextWave?.(gs);
  ui.renderUI?.(gs);
}

function tick(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (gs.mode === 'combat') {
    let finished = false;
    try { finished = !!combat.tickCombat?.(dt, gs); } catch (e) { console.error('[DL] tickCombat error:', e); }
    if (finished) endWave();
  } else {
    if (gs.autoStart) {
      const now = performance.now();
      const guard = (!gs.justStartedAt || now - gs.justStartedAt > 200) &&
                    (!gs.lastWaveEndedAt || now - gs.lastWaveEndedAt > 200);
      if (guard) startWave();
    }
  }

  render.draw?.(ctx, gs);
  ui.renderUI?.(gs);
  rafId = requestAnimationFrame(tick);
}

if (import.meta?.hot?.dispose) import.meta.hot.dispose(() => cancelAnimationFrame(rafId));
boot();
