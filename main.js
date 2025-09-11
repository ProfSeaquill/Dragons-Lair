// main.js — Dragon’s Lair bootstrap & game loop (fixed wave increment + 101-wave cap)

import * as state from './state.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as pathing from './pathing.js';
import * as combat from './combat.js';
import { getDragonStats, MAX_WAVES } from './state.js';

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

  try { window.dispatchEvent(new CustomEvent('dl-boot-ok')); } catch (_){}
}

function onStartWave() {
  if (!gs || gs.mode !== 'build') return;
  startWave();
}

function startWave() {
  // Block starting beyond the campaign cap
  if ((gs.wave | 0) > MAX_WAVES) {
    ui.toast?.('🏁 Run complete — you already beat King Arthur!');
    return;
  }

  if (!gs.path || !gs.path.length) {
    pathing.recomputePath?.(gs);
    if (!gs.path || !gs.path.length) { console.warn('[DL] startWave blocked: no valid path'); return; }
  }

  // 🔧 reset end-of-wave flags for the new wave
  gs._endedReason = null;
  gs._endedThisWave = false;

  combat.makeWave?.(gs);
  gs.mode = 'combat';
  gs._endedReason = null;
  gs._endedThisWave = false;
  gs.justStartedAt = performance.now();
  ui.renderUI?.(gs);
}

function endWave() {
  // Prevent double-invocation (which was causing 1→3→5)
  if (gs._endedThisWave) return;
  gs._endedThisWave = true;

  const reason = gs._endedReason || (gs.dragon?.hp <= 0 ? 'defeat' : 'victory');

  if (reason === 'victory') {
    // If we just cleared the final wave, end the run with a win screen
    if ((gs.wave | 0) >= MAX_WAVES) {
      gs.gameOver = true;
      gs.autoStart = false;
      gs.mode = 'build';
      ui.toast?.('🏆 Victory! King Arthur has fallen.');
      gs.lastWaveEndedAt = performance.now();
      ui.previewNextWave?.(gs);
      ui.renderUI?.(gs);
      return;
    }

    // ✅ Heal only on victory (and only if not final)
    const ds = state.getDragonStats(gs); // or getDragonStats(gs) if using named import
    const heal = ds.regenPerWave ?? 10;
    gs.dragon.hp = Math.min(gs.dragon.hpMax, gs.dragon.hp + heal);

    // Advance wave
    gs.wave = (gs.wave | 0) + 1;
    ui.toast?.(`Wave cleared! Dragon healed +${heal} HP`);
  } else {
    // ❌ Defeat: no heal, no wave increment
    gs.gameOver = true;
    gs.autoStart = false;
    ui.toast?.('💀 Game Over');
  }

  // Return to build mode (for restart / next wave)
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
    if (gs.autoStart && !gs.gameOver) {
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
