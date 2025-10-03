// debugOverlay.js
// Lightweight dev HUD. Toggle with F2 or ` (backtick). Persists flag in localStorage.
// Reads core stats from existing DOM HUD (wave, HP, gold, bones, auto-start).
// Expose optional setters for things we can't get from DOM (enemyCount, pathOK, cooldowns).

const LS_KEY = 'dl.debug.on';

let enabled = false;
let el = null;
let lastT = performance.now();
let frameCount = 0;
let fps = 0;

// Optional live metrics if you want to feed them each frame
let injected = {
  enemyCount: undefined,
  pathOK: undefined,
  cooldowns: undefined, // {gust, roar, stomp}
};

// DOM readers (safe fallbacks if elements are missing)
function g(id) { return document.getElementById(id); }
function readTextInt(id) {
  const n = parseInt((g(id)?.textContent || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}
function readTextFloat(id) {
  const f = parseFloat((g(id)?.textContent || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(f) ? f : undefined;
}
function readChecked(id) {
  const el = g(id);
  return (el && 'checked' in el) ? !!el.checked : undefined;
}

function ensureNode() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dl-debug';
  el.style.cssText = [
    'position:fixed','top:8px','left:8px','z-index:99998','pointer-events:none',
    'font:12px/1.25 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    'background:rgba(0,0,0,0.55)','color:#cfe7ff','padding:8px 10px','border:1px solid #243047',
    'border-radius:8px','white-space:pre','min-width:240px'
  ].join(';');
  document.body.appendChild(el);
  return el;
}

function setVisible(v) {
  enabled = v;
  if (enabled) {
    ensureNode().style.display = 'block';
  } else if (el) {
    el.style.display = 'none';
  }
  try { localStorage.setItem(LS_KEY, enabled ? '1' : '0'); } catch {}
}

function toggle() { setVisible(!enabled); }

function loadPersisted() {
  try { if (localStorage.getItem(LS_KEY) === '1') setVisible(true); } catch {}
}

// Public: mark a rendered frame (for FPS)
export function markFrame() {
  frameCount++;
  const now = performance.now();
  if (now - lastT >= 500) { // update FPS twice per second
    const inst = (frameCount * 1000) / (now - lastT);
    fps = fps ? (fps * 0.6 + inst * 0.4) : inst; // light EMA
    frameCount = 0;
    lastT = now;
  }
}

// Public: per-frame update. `extras` is optional.
export function tick(extras) {
  if (!enabled) return;

  if (extras) {
    if ('enemyCount' in extras) injected.enemyCount = extras.enemyCount;
    if ('pathOK'     in extras) injected.pathOK     = extras.pathOK;
    if ('cooldowns'  in extras) injected.cooldowns  = extras.cooldowns;
  }

  // Pull from existing HUD (cheap & decoupled)
  const wave  = readTextInt('wave');
  const hp    = readTextInt('dragonHP');
  const gold  = readTextInt('gold');
  const bones = readTextInt('bones');
  const timeS = readTextFloat('timer');
  const auto  = readChecked('autoStart');

  const cd = injected.cooldowns || {};
  const cdStr = (['gust','roar','stomp']
    .map(k => (k in cd) ? `${k}:${(cd[k] ?? 0).toFixed(1)}s` : null)
    .filter(Boolean)
    .join('  ')) || '—';

  const lines = [
    `FPS: ${fps.toFixed(1)}`,
    `Wave: ${wave ?? '—'}   HP: ${hp ?? '—'}   t: ${timeS?.toFixed?.(1) ?? '—'}s`,
    `Gold: ${gold ?? '—'}   Bones: ${bones ?? '—'}   Auto: ${auto ? 'on' : 'off'}`,
    `Enemies: ${injected.enemyCount ?? '—'}   PathOK: ${fmtBool(injected.pathOK)}`,
    `CD: ${cdStr}`,
    ``,
    `Toggle: F2 or \`    (persisted)`,
  ];

  ensureNode().textContent = lines.join('\n');
}

function fmtBool(v) {
  if (v === true) return '✔';
  if (v === false) return '✖';
  return '—';
}

// Optional external helpers if you want to set these from anywhere
export function setEnemyCount(n) { injected.enemyCount = n; }
export function setPathOK(b)     { injected.pathOK     = !!b; }
export function setCooldowns(o)  { injected.cooldowns  = o && { ...o }; }

// Init: bind keys & load persisted state
export function init() {
  loadPersisted();
  window.addEventListener('keydown', (e) => {
    // F2 or backtick/tilde (US keyboards)
    if (e.code === 'F2' || e.key === '`' || e.key === '~') {
      toggle();
      // prevent accidental console in some setups
      if (e.code === 'F2' || e.key === '`' || e.key === '~') {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  // Expose a tiny manual hook for convenience
  window.dlDebug = Object.freeze({
    toggle, on: () => setVisible(true), off: () => setVisible(false),
    setEnemyCount, setPathOK, setCooldowns,
  });
}

