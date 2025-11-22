// main.js — boot, game loop, UI wiring, and combat integration (named imports)
import * as Debug from './debugOverlay.js';
import { getCooldowns } from './combat.js';
import { installPermanentWalls } from './grid/walls.js';
import * as state from './state.js';
import { ensureFreshPathing, pathRenderOffset } from './state.js'; // new pathing API
import { bindUI, UI } from './ui.js';
import * as render from './render.js';
import { initLighting } from './lighting-webgl.js';
import { buyUpgrade } from './upgrades.js';
import { updateAgent } from './pathing/index.js';
// ----- Combat (robust namespace import; tolerant of export name variants) -----
import * as combat from './combat.js';
import './story.js'; // load narrative hooks (boss dialogue events)
import { isBossLevel, getBossId } from './story.js';
import { applyFlameVents } from './combat/upgrades/abilities/vents.js';


window.state = state;             // exposes state.GameState for console tools
window.GameState = state.GameState;

// ===== Phase 7: autosave =====
let __autosaveAccum = 0;
let __lastWaveSaved = 0;



async function loadConfigFiles() {
   const [tuningRaw, enemies, upgrades] = await Promise.all([
   fetch('./tuning.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
   fetch('./enemies.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
 ]);

  // Unwrap if the file is { "tuning": { ... } }
  const tuning = tuningRaw?.tuning ?? tuningRaw ?? null;

  // We no longer have waves.json; keep waves:null
  return { tuning, enemies, waves: null, upgrades };
}

// main.js (near top)
// Speed-scaled virtual clock so real-time systems (spawns, attacks) respect timeScale.
function installSpeedScaledClock() {
  if (typeof performance === 'undefined') return;
  if (performance.__dlSpeedClockInstalled) return;  // guard: only once

  // Keep references to the real clocks
  const realPerfNow = (performance.now && performance.now.bind(performance)) || null;
  const realDateNow = Date.now.bind(Date);

  const baseRealMs = realPerfNow ? realPerfNow() : realDateNow();
  let lastRealMs   = baseRealMs;
  let virtualMs    = baseRealMs;

  // For Date.now: anchor Unix epoch to current real time,
  // then add the same scaled delta we apply to performance.now.
  const baseUnixMs      = realDateNow();
  const basePerfForUnix = baseRealMs;

  performance.now = function dlSpeedNow() {
    const realNow = realPerfNow ? realPerfNow() : realDateNow();
    const realDt  = realNow - lastRealMs;
    lastRealMs    = realNow;

    // Read current speed from GameState (default 1×)
    const gs = (typeof state !== 'undefined') ? state.GameState : null;
    const speed = (gs && typeof gs.timeScale === 'number' && gs.timeScale > 0)
      ? gs.timeScale
      : 1;

    virtualMs += realDt * speed;
    return virtualMs;
  };

  // Keep Date.now consistent with the virtual performance.now
  Date.now = function dlSpeedDateNow() {
    const vPerf = performance.now(); // already virtual
    const delta = vPerf - basePerfForUnix;
    return baseUnixMs + delta;
  };

  performance.__dlSpeedClockInstalled = true;
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
if (typeof window !== 'undefined') window.state = state;

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

// --- Torch light pool (per-enemy) ------------------------------------------
const TorchLights = new Map(); // enemyId -> { x,y, r, color, initialized, waveTag, px,py }

function torchColorFor(e) { return [1.00, 0.86, 0.58]; } // keep your look
function torchRadius(t)  { return t * 0.80; }

function getOrMakeTorch(e, gs, t) {
  let L = TorchLights.get(e.id);
  if (!L) {
    L = { x: 0, y: 0, r: torchRadius(t), color: torchColorFor(e), initialized: false, waveTag: gs.__torchWaveId|0, px:0, py:0 };
    TorchLights.set(e.id, L);
  }
  return L;
}

// Treat enemies as “just spawned” if we first see them recently.
const __firstSeen = new Map(); // id -> ms timestamp

// Expose for combat.js clean-up (releaseEnemy)
globalThis.TorchLights = TorchLights;
globalThis.__firstSeen = __firstSeen;

function markFirstSeen(e) {
  if (!__firstSeen.has(e.id)) __firstSeen.set(e.id, performance.now());
}
function justSpawned(e, gs, ms = 60) {
  const born = e.tBorn || __firstSeen.get(e.id) || 0;
  return (performance.now() - born) <= ms || (e.__torchWaveId !== (gs.__torchWaveId|0));
}


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

  // --- Enemy-carried torches (sticky + hard-reset on first frame) ------------
if (Array.isArray(gs.enemies)) {
  for (const e of gs.enemies) {
    if (!ensureTorchBearer(e, gs)) continue;
    if (e.tunneling) continue;

    const p = enemyPixel(e, t);
    if (!p) continue;

    markFirstSeen(e);
    const L = getOrMakeTorch(e, gs, t);

    // Hard reset when newly bound / first frame of spawn / new wave tag
    if (!L.initialized || justSpawned(e, gs)) {
      L.x = p.x; L.y = p.y;
      L.px = p.x; L.py = p.y;          // reset smoothing history if you use it
      L.r = torchRadius(t);
      L.color = torchColorFor(e);
      L.initialized = true;
      L.waveTag = gs.__torchWaveId|0;
    } else {
      // Optional: light smoothing; keep subtle to avoid visible lag
      // L.x += 0.35 * (p.x - L.x);
      // L.y += 0.35 * (p.y - L.y);
      // If you dislike lag altogether, just keep L.x=L.y=p.* as above.
      L.x = p.x; L.y = p.y;
    }

    lights.push(L);
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
  // Prefer physics coords as the base
  const baseX = Number.isFinite(e.x) ? e.x
               : Number.isInteger(e.cx) ? (e.cx + 0.5) * t
               : null;
  const baseY = Number.isFinite(e.y) ? e.y
               : Number.isInteger(e.cy) ? (e.cy + 0.5) * t
               : null;
  if (baseX == null || baseY == null) return null;

  // Within ~60ms of spawn (or first-seen fallback), force-dominance of base over any stale draw*
  const bornMs = e.tBorn || __firstSeen.get(e.id) || 0;
  const fresh = (performance.now() - bornMs) <= 60;

  if (fresh || !Number.isFinite(e.drawX) || !Number.isFinite(e.drawY)) {
    // heal the smoothing cache immediately
    e.drawX = baseX;
    e.drawY = baseY;
  }

  // Start from the (now-healed) draw coords if present, else base.
  let px = Number.isFinite(e.drawX) ? e.drawX : baseX;
  let py = Number.isFinite(e.drawY) ? e.drawY : baseY;

  // Apply the same sub-tile offset renderer uses
  try {
    const off = typeof pathRenderOffset === 'function' ? pathRenderOffset(e, t) : [0, 0];
    px += off[0] || 0;
    py += off[1] || 0;
  } catch { /* no-op */ }

  return { x: px, y: py };
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

  // Real-time delta in seconds from RAF
  const rawDt = Math.max(0, (now - lastT)) / 1000;
  lastT = now;

  // Determine current time scale (1× or 2×)
  const gs = state.GameState;
  const speed = (typeof gs?.timeScale === 'number' && gs.timeScale > 0) ? gs.timeScale : 1;

  // Scaled simulation delta (but freeze sim when dialogue is active)
  let dt = rawDt * speed;
  if (gs && gs.dialogueActive) {
    dt = 0; // pause gameplay while dialogue box is open
  }

  // --- FSM time sync (ai/states/* reads gs.time.now/dt/t) ---
  {
    const nowSec = now / 1000;
    if (!gs.time) {
      gs.time = {
        now:   nowSec,
        dt:    dt,
        t:     0,
        since: (t) => nowSec - t,
      };
    }
    gs.time.now = nowSec;               // wall-clock seconds
    gs.time.dt  = dt;                   // scaled delta
    gs.time.t   = (gs.time.t || 0) + dt; // accumulated sim time
  }

  // 1) update game state
  update(dt);

  // 2) draw scene into offscreen 2D
  sceneCtx.globalCompositeOperation = 'source-over';
  sceneCtx.globalAlpha = 1;
  if ('filter' in sceneCtx) sceneCtx.filter = 'none';
  render.draw(sceneCtx, state.GameState);

  Debug.markFrame();
  Debug.tick({
    // (you can add probes here later)
  });

  // 3) build lights & present via WebGL
  const lights = computeTorchLights(state.GameState);
  const ambient = 0.58; // lower values = brighter map

  // --- stomp ripple descriptor → WebGL ---
  let ripple = null;
  {
    const arr = state.GameState.effects || [];
    // Scan from the end so the newest stompRipple wins
    for (let i = arr.length - 1; i >= 0; i--) {
      const fx = arr[i];
      if (!fx || fx.type !== 'stompRipple') continue;
      const dur = fx.dur || 0.7;
      const t   = fx.t || 0;
      const progress = dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0;

      ripple = {
        active: true,
        x: fx.x || 0,
        y: fx.y || 0,
        progress,
        maxRadius:   fx.maxRadius   || ((state.GRID.tile || 32) * 6),
        strengthPx:  fx.strengthPx  ?? ((state.GRID.tile || 32) * 0.45),
        bandWidthPx: fx.bandWidthPx ?? ((state.GRID.tile || 32) * 0.9),
      };
      break;
    }
  }

  if (typeof lighting.setRipple === 'function') {
    lighting.setRipple(ripple);
  }

  lighting.render(sceneCanvas, lights, ambient);

  requestAnimationFrame(frame);
}



// ---------- Boot ----------
function boot() {
  installSpeedScaledClock();
  // lock Start until config is loaded
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.disabled = true;

  // Bind all CustomEvent listeners before UI wiring
  window.addEventListener('dl-start-wave', () => { startWave(); });

    // --- FSM time bootstrap (exists even before the first frame) ---
  {
    const nowSec = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() / 1000
      : Date.now() / 1000;

    const gs = state.GameState;

    if (!gs.time) {
      gs.time = {
        now:   nowSec,
        dt:    0,
        t:     0,
        since: (t) => nowSec - t,
      };
    }
    if (typeof gs.timeScale !== 'number' || gs.timeScale <= 0) {
      gs.timeScale = 1;
    }
    gs.tileSize = state.GRID.tile;
  }

   // Init debug overlay (it will wait for dl-boot-ok from ui.bindUI)
  Debug.init();

  // --- UI event wiring (unchanged) ---
  window.addEventListener('dl-heal', () => {
    const { healed, reason } = state.healDragon(state.GameState);
    if (healed > 0) {
      UI.refreshHUD?.();
      UI.tell?.(`Healed ${healed} HP`);
    } else {
      UI.tell?.(reason === 'full' ? 'HP already full' : 'Not enough bones');
    }
  });

   window.addEventListener('dl-speed-toggle', () => {
  const gs = state.GameState;
  const next = (typeof gs.timeScale === 'number' && gs.timeScale > 1) ? 1 : 2;
  gs.timeScale = next;
  UI.refreshHUD?.();
  UI.tell?.(next > 1 ? 'Speed: 2×' : 'Speed: 1×');
});
   
  window.addEventListener('dl-auto-start', (e) => {
    state.GameState.autoStart = !!e.detail;
    UI.refreshHUD?.();
    UI.tell?.(state.GameState.autoStart ? 'Auto-start ON' : 'Auto-start OFF');
  });

  window.addEventListener('dl-save', () => {
    const ok = state.saveState(state.GameState);
    globalThis.Telemetry?.log(`save:${ok ? 'success' : 'fail'}`, { manual: true });
    UI.tell?.(ok ? 'Saved' : 'Save failed', ok ? '#8f8' : '#f88');
  });

  window.addEventListener('dl-load', () => {
    if (state.loadState()) {
      UI.refreshHUD?.();
      UI.tell?.('Loaded', '#8f8');
    } else {
      UI.tell?.('No save found', '#f88');
    }
  });

  window.addEventListener('dl-save-clear', () => {
    const ok = state.clearSave();
    globalThis.Telemetry?.log('save:clear', { ok: !!ok });
    UI.tell?.(ok ? 'Save cleared' : 'No save to clear');
  });

  window.addEventListener('dl-upgrade-buy', (e) => {
    const id = e.detail?.id;
    if (!id) return;
    const ok = buyUpgrade(state.GameState, id);
    if (ok) {
      UI.refreshHUD?.(); // triggers button re-eval when gold changes
      globalThis.Telemetry?.log('upgrade:buy', { id, level: state.GameState.upgrades?.[id] | 0 });
      UI.tell?.(`Upgraded ${id}`);
    } else {
      UI.tell?.('Not enough gold');
    }
  });
   
   // When combat performs a hard end-of-wave wipe, clear light caches here too.
window.addEventListener('dl-wave-hardened-wipe', () => {
  try { TorchLights.clear?.(); } catch(_) {}
  try { __firstSeen.clear?.(); } catch(_) {}
});


  // ---- Load config, apply, then wire UI and finish boot ----
  loadConfigFiles()
    .then(cfg => {
      console.debug(
        'tuning.waves present?',
        !!state.getCfg(state.GameState)?.tuning?.waves,
        state.getCfg(state.GameState)?.tuning?.waves
      );



// After config load + before the game loop starts, do:
state.applyConfig(state.GameState, cfg);
 installPermanentWalls(state.GameState);
 state.GameState.topologyVersion = (state.GameState.topologyVersion || 0) + 1; // bump first
 ensureFreshPathing(state.GameState); // new pathing build
      
      const cfgNow = state.getCfg(state.GameState);
      console.log('[A after applyConfig]', {
        hasCfg:    !!cfgNow,
        hasTuning: !!cfgNow?.tuning,
        tuningKeys: Object.keys(cfgNow?.tuning || {}),
        hasWaves:  !!cfgNow?.tuning?.waves,
        wavesKeys:
          (cfgNow?.tuning?.waves &&
           typeof cfgNow.tuning.waves === 'object' &&
           !Array.isArray(cfgNow.tuning.waves))
            ? Object.keys(cfgNow.tuning.waves)
            : null
      });

      // Wire UI after listeners are set
      bindUI();

      
      // now it’s safe to run the game loop
      lastT = performance.now();
      requestAnimationFrame(frame);

      // (optional) initial UI passes
      UI.renderUpgradesPanel?.();
      UI.refreshHUD?.();
      UI.tell?.('Config loaded');

      // enable Start button and emit preview refresh
      const startBtn2 = document.getElementById('startBtn');
      if (startBtn2) startBtn2.disabled = false;
      window.dispatchEvent(new CustomEvent('dl-preview-refresh'));
    })
    .catch(err => {
      console.error('loadConfigFiles failed', err);
      // Fallback: apply defaults & still bring up UI so the game is usable
      state.applyConfig(state.GameState, {});
      bindUI();
      UI.refreshHUD?.();
      const startBtn3 = document.getElementById('startBtn');
      if (startBtn3) startBtn3.disabled = false;
    });
}       

// --- Narrative helper (story.js integration) ---
// lines: Array<{ speaker, text, mood?, portrait?, sfx?, speed? }>
function showDialogue(lines) {
  const gs = state.GameState;

  if (!Array.isArray(lines) || lines.length === 0) {
    return Promise.resolve();
  }

  // Helper toggles
  const markActive = () => { if (gs) gs.dialogueActive = true; };
  const markInactive = () => { if (gs) gs.dialogueActive = false; };

  // Prefer dedicated UI-layer dialogue if available
  if (UI && typeof UI.showDialogue === 'function') {
    try {
      markActive();
      const p = UI.showDialogue(lines);

      // If UI.showDialogue returns a Promise, clear the flag when it finishes
      if (p && typeof p.then === 'function') {
        return p.finally(markInactive);
      }

      // If it doesn't return a Promise, treat it as instantaneous
      markInactive();
      return Promise.resolve();
    } catch (err) {
      console.warn('[story] UI.showDialogue failed, falling back to HUD banner', err);
      // make sure we don't stay stuck paused on error
      markInactive();
    }
  }

  // Fallback: simple HUD banner messages (non-blocking, no pause needed)
  for (const line of lines) {
    const speaker = line.speaker || '';
    const prefix =
      speaker === 'dragon'
        ? '🐉 '
        : speaker
          ? `${speaker}: `
          : '';
    UI.tell?.(prefix + line.text);
  }

  return Promise.resolve();
}


// Bridge story.js boss events → on-screen dialogue
window.addEventListener('dl-story-dialog', (ev) => {
  const lines = ev?.detail?.lines;
  if (!lines || !lines.length) return;

  // Fire-and-forget; UI.showDialogue can queue internally if needed
  showDialogue(lines);
});


async function startWave() {
  if (!state.GameState.cfgLoaded) return; // don’t start waves before tuning exists

  const gs = state.GameState;

  console.log('[B startWave guard]', state.getCfg(state.GameState)?.tuning?.waves);

  gs.phase = 'wave';            // ← lock wall building
  gs.__torchWaveId = (gs.__torchWaveId || 0) + 1;
  gs.__firstTorchGiven = false;

  // Reset per-wave torch lights so old positions don't interpolate in
  TorchLights.clear();
  __firstSeen.clear();

  // --- Ensure topology & trail exist before combat.startWave ---
  ensureFreshPathing(gs);
  if (!gs.successTrail) {
    const W = state.GRID.cols, H = state.GRID.rows;
    gs.successTrail = state.makeScalarField(W, H, 0);
  }
  gs._straysActive = 0;

  if (typeof combatStartWave === 'function') {
    combatStartWave(state.GameState);
  } else if (typeof combatSpawnWave === 'function') {
    combatSpawnWave(state.GameState);
  }

  waveJustStartedAt = performance.now();

  globalThis.Telemetry?.log('wave:start', { wave: state.GameState.wave | 0 });

  // --- Phase 7: disable autosave by default ---
  state.GameState.dev = state.GameState.dev || {};
  state.GameState.dev.autosave = false;
}


function update(dt) {
  ensureFreshPathing(state.GameState);
  const gs = state.GameState;
   
  // --- DIAG: enemy lifecycle heartbeat (1x/sec) ---
{
  gs.__diagT = (gs.__diagT ?? 0) + dt;
  if (gs.__diagT >= 1.0) {
    gs.__diagT = 0;
    const enemies = gs.enemies || [];
    const alive = enemies.filter(e => e && !e.dead);
    const tunn = alive.filter(e => e.tunneling).length;
    const vis  = alive.filter(e => !e.tunneling).length;
    const first = alive[0] ? {
      id: alive[0].id, type: alive[0].type, cx: alive[0].cx, cy: alive[0].cy,
      dead: !!alive[0].dead, tunneling: !!alive[0].tunneling,
      hasFSM: !!alive[0]._fsm, pxps: alive[0].pxPerSec
    } : null;
  }
}


    // ---- FSM time shim (seconds everywhere) ----
{
  const __now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() / 1000    // seconds
    : Date.now() / 1000;          // seconds (fallback)

  if (!gs.time) {
    gs.time = {
      now: __now,
      dt,
      since: (t) => __now - t,    // returns seconds
    };
  } else {
    gs.time.now = __now;
    gs.time.dt  = dt;
    if (typeof gs.time.since !== 'function') {
      gs.time.since = (t) => __now - t; // seconds
    }
  }
}


    // End-of-wave detection (simple + robust):
    const anyAlive = gs.enemies && gs.enemies.length > 0;
  const cooldownMs = 400; // tiny grace after start to avoid flicker
  const justStarted = (performance.now() - waveJustStartedAt) < cooldownMs;

  if (!anyAlive && !justStarted) {
    gs.phase = 'build';         // ← unlock building
  }

  
  // (nice-to-have:) expose tile size for AI that relies on it
  if (gs.tileSize == null) gs.tileSize = state.GRID.tile;


  // --- Ensure containers exist early (prevents .filter / for-of crashes) ---
  if (!Array.isArray(gs.enemies)) gs.enemies = [];
  if (!Array.isArray(gs.effects)) gs.effects = [];

  // --- Game Over guard ---
if ((gs.dragonHP | 0) <= 0) {
  if (!gs.gameOver) {
    gs.gameOver = true;

    const wave = gs.wave | 0;           

    // if this happened on a boss level, emit boss victory for story.js
    if (isBossLevel && isBossLevel(wave)) {
      const id = getBossId ? getBossId(wave) : null;
      try {
        window.dispatchEvent?.(
          new CustomEvent('dl-boss-victory', {
            detail: { wave, id, type: 'boss' },
          })
        );
      } catch (_) {}
    }
    // END

    globalThis.Telemetry?.log('dragon:death', { wave });
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

   if (typeof applyFlameVents === 'function') {
  applyFlameVents(gs, dt);
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
    {
    const arr = gs.effects || [];
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const fx = arr[i];
      if (fx && !fx.dead) arr[w++] = fx;
    }
    arr.length = w; // ← mutate in place; DO NOT reassign gs.effects
  }



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
    if (!fx || fx.type === 'flameWave' || fx.type === 'stompRipple') continue;

    // ⛔ Do NOT auto-expire these; they are lifetime-managed elsewhere
    if (fx.type === 'tunnel' || fx.type === 'bomb') continue;

    if (fx.t == null) fx.t = 0;
    if (fx.dur == null) fx.dur = 0.6;
    fx.t += dt;
    if (fx.t >= fx.dur) fx.dead = true;
  }
  {
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const fx = arr[i];
      if (fx && !fx.dead) arr[w++] = fx;
    }
    arr.length = w;
  }
}


  // --- Phase 7: autosave ---
{
  const cfg = state.getCfg(state.GameState) || {};
  const dev = state.GameState.dev || {};
  // Enable if cfg.tuning.saves.autosaveSec > 0 OR dev.autosave truthy
  const autosaveSecCfg = cfg?.tuning?.saves?.autosaveSec;
  const autosaveFromDev = dev.autosave; // true or a number (seconds)
  const enabled = (typeof autosaveSecCfg === 'number' && autosaveSecCfg > 0) || !!autosaveFromDev;

  if (enabled) {
    const period =
      (typeof autosaveFromDev === 'number' && autosaveFromDev > 0)
        ? autosaveFromDev
        : (typeof autosaveSecCfg === 'number' ? autosaveSecCfg : 30);

    __autosaveAccum += dt;
    if (__autosaveAccum >= period) {
      __autosaveAccum = 0;
      const ok = state.saveState(state.GameState);
      UI.tell?.(ok ? 'Saved' : 'Save failed', ok ? '#8f8' : '#f88');
    }

    // On wave end: detect wave increment and save once
    const w = state.GameState.wave | 0;
    if (w !== __lastWaveSaved) {
      __lastWaveSaved = w;
      const ok = state.saveState(state.GameState);
      UI.tell?.(ok ? 'Saved' : 'Save failed', ok ? '#8f8' : '#f88');
    }
  } else {
    __autosaveAccum = 0;
    __lastWaveSaved = state.GameState.wave | 0;
  }
}

}
// ---------- Go ----------
boot();
