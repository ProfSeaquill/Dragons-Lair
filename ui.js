// ui.js — edge-wall build mode + HUD + Next Wave preview + Dev Panel
import * as state from './state.js';
import * as walls from './grid/walls.js';
import * as upgrades from './upgrades.js';
import { getBossId, BOSS_SCHEDULE } from './story.js';
import { drawEnemyGlyph } from './render.js';


// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const hud = {
  wave:    $('wave'),
  hp:      $('dragonHP'),
  gold:    $('gold'),
  bones:   $('bones'),
  msg:     $('msg'),
  healBtn: $('healBtn'),
  start:   $('startBtn'),
  auto:    $('autoStart'),
  speed:   $('speedBtn'), 
  save:    $('saveBtn'),
  load:    $('loadBtn'),
  canvas:  $('game'),
  upgrades: $('upgrades'),
  preview:  $('preview'),
  clear:   $('clearBtn'),
};

// For render.js hover highlight
state.GameState.uiHoverEdge = null;

// ---------- Story Dialogue Layer (boss conversations) ----------
const SPEAKER_LABELS = {
  dragon:   'Cargarax',
  mordred:  'Sir Mordred',
  kay:      'Sir Kay',
  palamedes:'Sir Palamedes',
  gawain:   'Sir Gawain',
  percival: 'Sir Percival',
  bors:     'Sir Bors',
  tristan:  'Sir Tristan',
  galahad:  'Sir Galahad',
  bedivere: 'Sir Bedivere',
  lancelot: 'Sir Lancelot',
  arthur:   'King Arthur',
};

// 🔧 Portrait assets (update paths to match your actual filenames)
const DRAGON_PORTRAIT_SRC = './assets/portraits/cargarax_portrait.png';
const KNIGHT_PORTRAIT_SRC = './assets/portraits/knight1_portrait.png';

const SPEAKER_PORTRAITS = {
  dragon: { src: DRAGON_PORTRAIT_SRC, side: 'right' }, // faces left, on the right side
  defaultKnight: { src: KNIGHT_PORTRAIT_SRC, side: 'left' },
};

let dlgRoot = null;
let dlgBox, dlgContent, dlgSpeaker, dlgText, dlgHint;
let dlgActive = false;
let dlgLines = [];
let dlgIndex = 0;
let dlgResolve = null;
let dlgTypingTimer = null;
let dlgTypingDone = true;
let dlgFullText = '';

// Portrait layout elements
let dlgMainRow = null;
let dlgPortraitWrap = null;
let dlgPortraitImg = null;


function ensureDialogueLayer() {
  if (dlgRoot) return;

  dlgRoot = document.createElement('div');
  dlgRoot.id = 'dlDialogueLayer';
  dlgRoot.style.position = 'fixed';
  dlgRoot.style.left = '0';
  dlgRoot.style.right = '0';
  dlgRoot.style.top = '0';
  dlgRoot.style.bottom = '0';
  dlgRoot.style.zIndex = '999';
  dlgRoot.style.display = 'none';

  // Center the box horizontally *and* vertically
  dlgRoot.style.justifyContent = 'center';
  dlgRoot.style.alignItems = 'center';
  dlgRoot.style.pointerEvents = 'auto';
  dlgRoot.style.padding = '12px';
  dlgRoot.style.boxSizing = 'border-box';

  dlgBox = document.createElement('div');
  dlgBox.style.background = 'rgba(6,10,24,0.94)';
  dlgBox.style.border = '1px solid #445';
  dlgBox.style.borderRadius = '10px';
  dlgBox.style.padding = '8px 14px 10px';
  dlgBox.style.minWidth = '320px';
  dlgBox.style.maxWidth = '720px';
  dlgBox.style.color = '#f5f7ff';
  dlgBox.style.fontFamily = 'system-ui, sans-serif'; // leave font + size as-is
  dlgBox.style.fontSize = '14px';
  dlgBox.style.boxShadow = '0 0 18px rgba(0,0,0,0.65)';
  dlgBox.style.cursor = 'pointer';

  // Fixed-size box + vertical layout
  dlgBox.style.width = '420px';        // fixed width
  dlgBox.style.height = '140px';       // fixed height
  dlgBox.style.display = 'flex';
  dlgBox.style.flexDirection = 'column';
  dlgBox.style.boxSizing = 'border-box';
  dlgBox.style.overflow = 'hidden';
  dlgBox.style.wordWrap = 'break-word';
  dlgBox.style.lineHeight = '1.3';

  // ── NEW: main row = [portrait] [speaker + text] ─────────────────────────
  dlgMainRow = document.createElement('div');
  dlgMainRow.style.flex = '1 1 auto';
  dlgMainRow.style.display = 'flex';
  dlgMainRow.style.flexDirection = 'row'; // we may flip this per speaker
  dlgMainRow.style.gap = '10px';

  dlgPortraitWrap = document.createElement('div');
  dlgPortraitWrap.style.flex = '0 0 auto';
  dlgPortraitWrap.style.width = '96px';
  dlgPortraitWrap.style.height = '96px';
  dlgPortraitWrap.style.background = '#101625';
  dlgPortraitWrap.style.borderRadius = '6px';
  dlgPortraitWrap.style.overflow = 'hidden';
  dlgPortraitWrap.style.display = 'flex';
  dlgPortraitWrap.style.alignItems = 'center';
  dlgPortraitWrap.style.justifyContent = 'center';
  dlgPortraitWrap.style.border = '1px solid #222b3d';

  dlgPortraitImg = document.createElement('img');
  dlgPortraitImg.style.maxWidth = '100%';
  dlgPortraitImg.style.maxHeight = '100%';
  dlgPortraitImg.style.display = 'block';
  dlgPortraitImg.style.imageRendering = 'pixelated';

  dlgPortraitWrap.appendChild(dlgPortraitImg);

  // Inner content area (speaker + text)
  dlgContent = document.createElement('div');
  dlgContent.style.flex = '1 1 auto';
  dlgContent.style.display = 'flex';
  dlgContent.style.flexDirection = 'column';

  dlgSpeaker = document.createElement('div');
  dlgSpeaker.style.fontWeight = '600';
  dlgSpeaker.style.marginBottom = '4px';
  dlgSpeaker.style.opacity = '0.9';

  dlgText = document.createElement('div');
  dlgText.style.minHeight = '32px';
  dlgText.style.lineHeight = '1.4';
  dlgText.style.whiteSpace = 'pre-wrap'; // preserve line breaks in story text

  dlgContent.appendChild(dlgSpeaker);
  dlgContent.appendChild(dlgText);

  dlgMainRow.appendChild(dlgPortraitWrap);
  dlgMainRow.appendChild(dlgContent);

  dlgHint = document.createElement('div');
  dlgHint.style.marginTop = '4px';   // small gap above hint
  dlgHint.style.fontSize = '11px';
  dlgHint.style.opacity = '0.7';
  dlgHint.textContent = 'Click or press Space/Enter to continue…';

  dlgBox.appendChild(dlgMainRow);
  dlgBox.appendChild(dlgHint);

  dlgRoot.appendChild(dlgBox);
  document.body.appendChild(dlgRoot);

  dlgRoot.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    dialogueAdvance();
  });

  window.addEventListener('keydown', (ev) => {
    if (!dlgActive) return;
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      dialogueAdvance();
    }
  });
}


function dialogueStartTyping(text, speed) {
  if (dlgTypingTimer) {
    clearInterval(dlgTypingTimer);
    dlgTypingTimer = null;
  }
  dlgFullText = String(text || '');
  dlgText.textContent = '';
  if (!dlgFullText) {
    dlgTypingDone = true;
    return;
  }

  // Interpret line.speed as chars-per-second (see story.js TYPE)
  const cps = (typeof speed === 'number' && speed > 0) ? speed : 22;
  const delay = 1000 / cps;
  let i = 0;
  dlgTypingDone = false;

  dlgTypingTimer = setInterval(() => {
    if (i >= dlgFullText.length) {
      clearInterval(dlgTypingTimer);
      dlgTypingTimer = null;
      dlgTypingDone = true;
      dlgText.textContent = dlgFullText;
      return;
    }
    i++;
    dlgText.textContent = dlgFullText.slice(0, i);
  }, delay);
}

function dialogueFinishTyping() {
  if (dlgTypingTimer) {
    clearInterval(dlgTypingTimer);
    dlgTypingTimer = null;
  }
  dlgTypingDone = true;
  dlgText.textContent = dlgFullText;
}

function dialogueShowNext() {
  if (!dlgLines || dlgIndex >= dlgLines.length) {
    dialogueEnd();
    return;
  }

  const line = dlgLines[dlgIndex++] || {};
  const id = line.speaker || '';
  const label =
    SPEAKER_LABELS[id] ||
    (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');

  dlgSpeaker.textContent = label || '';
  dlgSpeaker.dataset.speaker = id || '';

  // 🔧 NEW: portrait selection
  const cfg = getPortraitConfigForLine(line);
  if (cfg && dlgPortraitImg && dlgPortraitWrap && dlgMainRow) {
    dlgPortraitImg.src = cfg.src;
    dlgPortraitImg.alt = label || '';
    dlgPortraitWrap.style.display = 'flex';

    // Knights on the left facing right, dragon on the right facing left
    dlgMainRow.style.flexDirection = (cfg.side === 'right') ? 'row-reverse' : 'row';
  } else if (dlgPortraitWrap) {
    dlgPortraitWrap.style.display = 'none';
  }

  dialogueStartTyping(line.text, line.speed);
}


function dialogueAdvance() {
  if (!dlgActive) return;
  if (!dlgTypingDone) {
    dialogueFinishTyping();
  } else {
    dialogueShowNext();
  }
}

function dialogueEnd() {
  dlgActive = false;
  if (dlgTypingTimer) {
    clearInterval(dlgTypingTimer);
    dlgTypingTimer = null;
  }
  if (dlgRoot) {
    dlgRoot.style.display = 'none';
  }
  document.body.classList.remove('dl-dialogue-open');

  const resolve = dlgResolve;
  dlgResolve = null;
  dlgLines = [];
  dlgIndex = 0;

  if (resolve) resolve();
}

function getPortraitConfigForLine(line) {
  if (!line) return null;
  // Allow explicit portrait override later: line.portrait = 'dragon' | 'knightFoo' etc.
  const key = line.portrait || line.speaker;
  if (key === 'dragon') {
    return SPEAKER_PORTRAITS.dragon;
  }
  // All the Round Table folks use the generic knight portrait for now.
  return SPEAKER_PORTRAITS.defaultKnight;
}


// ---------- Enemy meta for the Preview ----------
const ENEMY_META = {
  villager:   { name: 'Villager',  color: '#9acd32', blurb: 'Basic grunt. Slow and squishy.' },
  squire:     { name: 'Squire',    color: '#7fd1ff', blurb: 'A bit tougher and better-trained than a villager.' },
  knight:     { name: 'Knight',    color: '#ffd166', blurb: 'Fast mover with solid hp and damage.' },
  hero:       { name: 'Hero',      color: '#ff6b6b', blurb: 'Shield-bearer: blocks direct fire for units behind him.' },
  engineer:   { name: 'Engineer',  color: '#c084fc', blurb: 'Tunnels to the lair and plants a timed bomb.' },
  kingsguard: { name: 'King\'s Guard', color: '#ffa8a8', blurb: 'Miniboss: heavier Knight, moves a bit slower but hits harder.' },
  boss:       { name: 'Knight of the Round Table', color: '#f4a261', blurb: 'Knight of the Round Table: massive HP and damage.' },
};

// Boss display names for the Next Wave preview, keyed by story.js boss id
const BOSS_PREVIEW_NAME = {
  mordred:   'Sir Mordred',
  kay:       'Sir Kay',
  palamedes: 'Sir Palamedes',
  gawain:    'Sir Gawain',
  percival:  'Sir Percival',
  bors:      'Sir Bors',
  tristan:   'Sir Tristan',
  galahad:   'Sir Galahad',
  bedivere:  'Sir Bedivere',
  lancelot:  'Sir Lancelot',
  arthur:    'King Arthur',
};

// ---------- Config helpers (economy) ----------
function edgeCost(gs) {
  return ((state.getCfg(gs)?.tuning?.economy?.wallCostBones) ?? 1) | 0;
}
function edgeRefund(gs) {
  return ((state.getCfg(gs)?.tuning?.economy?.wallRefundBones) ?? 0) | 0;
}

// Cache the combat module (so we can ask it for wave composition/cooldowns)
let _combatMod = null;
async function getCombat() {
  if (_combatMod) return _combatMod;
  _combatMod = await import('./combat.js');
  return _combatMod;
}

// ---------- Public API ----------
export function bindUI() {
  wireButtons();
  wireCanvasEdgeBuild();
  renderUpgradesPanel();
  refreshHUD();          // also triggers first preview render
  ensureDevPanel();
  window.dispatchEvent(new CustomEvent('dl-boot-ok'));
}

// Track last values so we only rebuild when needed
let _lastPreviewWave = -1;
let _lastGold = -1;
let _lastWaveHUD = -1;
let _lastBones = -1;
let _lastHPStr = '';
let _lastAuto = null;
let _lastSpeed = null;
let _abilityLoopInit = false;
let _hoverKey = null;
let _hoverHasWall = null;
let _abilityButtons = []; // [{ key, btn }]


// ---------- Optional small API for main/render ----------
export const UI = { refreshHUD, tell, renderUpgradesPanel, showDialogue };

// Boss / story dialogue API (used by main.js)
export function showDialogue(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return Promise.resolve();
  }

  // If another dialogue is somehow active, end it cleanly first.
  if (dlgActive) {
    dialogueEnd();
  }

  ensureDialogueLayer();

  dlgLines = lines.slice(); // copy to avoid outside mutation
  dlgIndex = 0;
  dlgActive = true;

  if (dlgRoot) {
    dlgRoot.style.display = 'flex';
  }
  document.body.classList.add('dl-dialogue-open');

  return new Promise((resolve) => {
    dlgResolve = resolve;
    dialogueShowNext();
  });
}

// Lightweight message banner
function tell(s, color = '') {
  if (!hud.msg) return;
  const same = (hud.msg.textContent === String(s)) && (hud.msg.style.color === (color || ''));
  if (!same) {
    hud.msg.textContent = String(s);
    hud.msg.style.color = color || '';
  }
  if (s) {
    clearTimeout(tell._t);
    tell._t = setTimeout(() => { if (hud.msg.textContent === s) hud.msg.textContent = ''; }, 2500);
  }
}

export function refreshHUD() {
  const gs = state.GameState;
  const ds = state.getDragonStatsTuned(gs);

  // Dev: top up first (this may change gold/bones)
  if (gs.dev?.infiniteMoney) {
    if ((gs.gold | 0)  < 500_000) gs.gold  = 1_000_000;
    if ((gs.bones | 0) < 500_000) gs.bones = 1_000_000;
  }

  // --- GOLD ---
  const goldNow = gs.gold | 0;
  if (hud.gold) hud.gold.textContent = String(goldNow);
  if (goldNow !== _lastGold) {
    _lastGold = goldNow;
    renderUpgradesPanel();
  }

  // --- Rest of HUD ---
  const waveNow  = gs.wave | 0;
  const bonesNow = gs.bones | 0;
  const hpStrNow = `${gs.dragonHP | 0}/${ds.maxHP | 0}`;
  const autoNow  = !!gs.autoStart;
  const speedNow = (typeof gs.timeScale === 'number' && gs.timeScale > 0) ? gs.timeScale : 1;

  if (hud.wave && waveNow !== _lastWaveHUD) { _lastWaveHUD = waveNow; hud.wave.textContent = String(waveNow); }
  if (hud.bones && bonesNow !== _lastBones) { _lastBones = bonesNow; hud.bones.textContent = String(bonesNow); }
  if (hud.hp && hpStrNow !== _lastHPStr)    { _lastHPStr = hpStrNow; hud.hp.textContent = hpStrNow; }
  if (hud.auto && autoNow !== _lastAuto)    { _lastAuto = autoNow;   hud.auto.checked = autoNow; }

  // 🔧 Fix: close the speed block here so preview & heal/grid are NOT gated on speed changes
  if (hud.speed && speedNow !== _lastSpeed) {
    _lastSpeed = speedNow;
    hud.speed.textContent = `${speedNow}× Speed`;
  }

  // 🔁 Wave preview should depend on wave, not speed
  if (gs.cfgLoaded && (waveNow !== _lastPreviewWave)) {
    _lastPreviewWave = waveNow;
    renderNextWavePreview().catch(err => console.warn('preview failed:', err));
  }

  // These should run every refresh (or at least not be tied to speed)
  renderHealButtonLabel(gs);
  renderGridHelp(gs);
}

// ---------- Buttons / HUD wiring ----------
function wireButtons() {
  if (hud.healBtn) {
    hud.healBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-heal'));
    });
  }

  if (hud.start) {
    hud.start.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-start-wave'));
      tell('Wave starting...');
    });
  }

  if (hud.auto) {
    hud.auto.addEventListener('change', (e) => {
      window.dispatchEvent(new CustomEvent('dl-auto-start', { detail: !!e.target.checked }));
    });
  }

  if (hud.speed) {
  hud.speed.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('dl-speed-toggle'));
  });
}
  
  if (hud.save) {
    hud.save.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-save'));
    });
  }

  if (hud.load) {
    hud.load.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-load'));
    });
  }

  if (hud.clear) {
    hud.clear.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dl-save-clear'));
    });
  }
}

function renderHealButtonLabel(gs) {
  const btn = document.getElementById('healBtn');
  if (!btn) return;
  const costPerHP = (state.getCfg(gs)?.tuning?.dragon?.healCostBone ?? 1) | 0;
  const unit = costPerHP === 1 ? 'bone' : 'bones';
  btn.textContent = `Heal (1 HP / ${costPerHP} ${unit})`;
}

// ---------- Upgrades panel ----------
export function renderUpgradesPanel() {
  const root = hud.upgrades;
  if (!root) return;

  const data = upgrades.getUpgradeInfo(state.GameState);
  const list = Array.isArray(data) ? data : Object.values(data);
  root.innerHTML = '';

  _abilityButtons = []; // reset the live list each render

  list.forEach(info => {
    const row = document.createElement('div');
    row.className = 'uRow';

    const name  = document.createElement('div');
    const buy   = document.createElement('button');
    const small = document.createElement('small');

    name.textContent = `${info.title} (Lv ${info.level})`;
    small.textContent = info.desc || '';
    buy.className = 'btn';
    if (info.isMax) {
      buy.textContent = 'MAX';
      buy.disabled = true;
      buy.title = `Max level${info.max ? ` (${info.max})` : ''} reached`;
    } else {
      buy.textContent = `Buy ${info.cost}g`;
      buy.disabled = (state.GameState.gold | 0) < (info.cost | 0);
      buy.title = '';
    }

    buy.addEventListener('click', () => {
      if (info.isMax) return;
      window.dispatchEvent(new CustomEvent('dl-upgrade-buy', {
        detail: { id: info.key, title: info.title, cost: info.cost }
      }));
    });

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.appendChild(name);
    if (info.desc) left.appendChild(small);

    row.appendChild(left);
    row.appendChild(buy);

    // Ability Use buttons (gust / roar / stomp)
    if (info.type === 'ability' && (info.key === 'gust' || info.key === 'roar' || info.key === 'stomp')) {
      const use = document.createElement('button');
      use.className = 'btn';
      use.textContent = 'Locked';
      use.disabled = true;

      use.addEventListener('click', () => {
        const U = state.GameState.upgrades || {};
        const lvlNow = (U[info.key] | 0);
        if (lvlNow <= 0) return;
        if (info.key === 'gust')  state.GameState.reqWingGust = true;
        if (info.key === 'roar')  state.GameState.reqRoar     = true;
        if (info.key === 'stomp') state.GameState.reqStomp    = true;
      });

      row.appendChild(use);
_abilityButtons.push({ key: info.key, btn: use });
    }

    root.appendChild(row);
  });

 // Live cooldown / lock updater (start once)
if (!_abilityLoopInit) {
  _abilityLoopInit = true;
  (async function abilityUseUpdater() {
    const combat = await getCombat();
    if (typeof combat.getCooldowns !== 'function') return;

    const label = (base, s) => (s > 0.05 ? `${base} (${s.toFixed(1)}s)` : base);

    function tick() {
      const cds = combat.getCooldowns();
      for (const { key, btn } of _abilityButtons) {
        const U = state.GameState.upgrades || {};
        const level = (U[key] | 0);
        const locked = level <= 0;

        if (locked) {
          btn.disabled = true;
          btn.textContent = 'Locked';
          btn.title = 'Buy at least 1 level to unlock';
        } else {
          const cd =
            key === 'gust'  ? (cds.gust  || 0) :
            key === 'roar'  ? (cds.roar  || 0) :
            key === 'stomp' ? (cds.stomp || 0) : 0;

          btn.disabled = cd > 0.05;
          btn.textContent = label('Use', cd);
          btn.title = cd > 0.05 ? `${key} on cooldown` : `Activate ${key}`;
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();
}
}

// ---------- Wall instructional text ----------
function renderGridHelp(gs) {
  const el = document.querySelector('.gridHelp');
  if (!el) return;

  if (!state.canEditMaze(gs)) {
    el.textContent = 'Build disabled during waves.';
    return;
  }

  const cost = edgeCost(gs);
  el.textContent =
    `Build Mode: Click a TILE EDGE to add a wall (${cost} bone${cost === 1 ? '' : 's'}). ` +
    `Right-click an edge wall to remove. Walls cannot fully block entry ↔ exit.`;
}
// Make available to main.js even if it calls it globally
// (keeps compatibility without changing main.js imports)
if (typeof window !== 'undefined') window.renderGridHelp = renderGridHelp;

// ---------- Canvas Edge Build Mode ----------
function wireCanvasEdgeBuild() {
  const cv = hud.canvas;
  if (!cv) return;

  // Prevent default context menu for right-click remove
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  cv.addEventListener('mousemove', (e) => {
    const gs = state.GameState;

// Hide the hover + do nothing while a wave is active
if (!state.canEditMaze(gs)) {
  gs.uiHoverEdge = null;
  _hoverKey = null;
  _hoverHasWall = null;
  return;
}

const hover = edgeHitTest(cv, e);
gs.uiHoverEdge = hover; // for render highlight
if (!hover) {
  if (_hoverKey !== null) {
    _hoverKey = null;
    _hoverHasWall = null;
    tell(''); // clear any stale message
  }
  return;
}

const hasWall = walls.edgeHasWall(gs, hover.x, hover.y, hover.side);
const k = `${hover.x},${hover.y},${hover.side}`;
if (k !== _hoverKey || hasWall !== _hoverHasWall) {
  _hoverKey = k;
  _hoverHasWall = hasWall;

const verb = hasWall ? 'Remove' : 'Place';
const refund = edgeRefund(gs) | 0;
const msg = hasWall
  ? (refund > 0 ? `Remove wall: (${hover.x},${hover.y}) ${hover.side} (+${refund} bones)` 
                : `Remove wall: (${hover.x},${hover.y}) ${hover.side}`)
  : `Place wall: (${hover.x},${hover.y}) ${hover.side} (${edgeCost(gs)} bones)`;
tell(msg, '#9cf');
}
  });

  cv.addEventListener('mouseleave', () => {
    state.GameState.uiHoverEdge = null;
  });

  cv.addEventListener('mousedown', (e) => {
    const gs = state.GameState;

    // Hard UI guard: no edits during waves
    if (!state.canEditMaze(gs)) {
      tell('You can only place/remove walls between waves.', '#f88');
      return;
    }

    const hover = edgeHitTest(cv, e);
    if (!hover) return;

    const place  = (e.button === 0);
    const remove = (e.button === 2);
    if (!place && !remove) return;

    const hasWall = walls.edgeHasWall(gs, hover.x, hover.y, hover.side);
    if (place && hasWall) return;
    if (remove && !hasWall) return;

    if (place) {
      const cost = edgeCost(gs);
      if ((gs.bones | 0) < cost) {
        tell('Not enough bones');
        return;
      }
      if (edgeTouchesDragon(gs, hover.x, hover.y, hover.side)) {
        tell("Can't build on the dragon", '#f88');
        return;
      }

      // Attempt to place
      walls.toggleEdge(gs, hover.x, hover.y, hover.side);

      // If placement was rejected (e.g., would fully block entry↔exit), don't charge
      const placed = walls.edgeHasWall(gs, hover.x, hover.y, hover.side);
      if (!placed) {
        tell("Can't block entry ↔ exit");
        return;
      }

      // Charge after successful placement
      gs.bones -= cost;
      globalThis.Telemetry?.log('wall:place', { x: hover.x, y: hover.y, side: hover.side, cost });

      // Ensure topology rebuild notices the change
      state.bumpTopology?.(gs, 'ui:edge-place');

    } else if (remove) {
      // Remove (no refund here; if you want, credit edgeRefund(gs) to gs.bones)
      walls.toggleEdge(gs, hover.x, hover.y, hover.side);
      globalThis.Telemetry?.log('wall:remove', { x: hover.x, y: hover.y, side: hover.side });

      state.bumpTopology?.(gs, 'ui:edge-remove');
    }

    // Keep HUD snappy after edits
    refreshHUD?.();
  });
}

function edgeHitTest(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (evt.clientX - rect.left) * scaleX;
  const my = (evt.clientY - rect.top) * scaleY;

  const t = state.GRID.tile;
  const cx = Math.floor(mx / t);
  const cy = Math.floor(my / t);
  if (!state.inBounds(cx, cy)) return null;

  const lx = mx - cx * t;
  const ly = my - cy * t;
  const edgePad = Math.max(4, Math.floor(t * 0.12));

  let side = null, dist = Infinity;
  const dN = ly;          if (dN <= edgePad && dN < dist) { side = 'N'; dist = dN; }
  const dS = t - ly;      if (dS <= edgePad && dS < dist) { side = 'S'; dist = dS; }
  const dW = lx;          if (dW <= edgePad && dW < dist) { side = 'W'; dist = dW; }
  const dE = t - lx;      if (dE <= edgePad && dE < dist) { side = 'E'; dist = dE; }

  if (!side) return null;
  return { x: cx, y: cy, side };
}

function edgeTouchesDragon(gs, x, y, side) {
  // side is 'N','S','E','W' for the edge on cell (x,y)
  const a = { x, y };
  const b = { x, y };
  if (side === 'N') b.y = y - 1;
  if (side === 'S') b.y = y + 1;
  if (side === 'W') b.x = x - 1;
  if (side === 'E') b.x = x + 1;
  return state.isDragonCell(a.x, a.y, gs) || state.isDragonCell(b.x, b.y, gs);
}

// ---------- Next Wave Preview ----------
async function renderNextWavePreview() {
  const root = hud.preview;
  if (!root) return;
  root.innerHTML = '';

    const combat = await getCombat();
  const wave = state.GameState.wave | 0;
  const bossId = BOSS_SCHEDULE?.[wave] || null;


  // ✅ Always use the same function you just tested in the console
  const counts = (typeof combat.previewWaveCounts === 'function')
    ? combat.previewWaveCounts(wave)
    : (() => {
        const list = (typeof combat.previewWaveList === 'function')
          ? combat.previewWaveList(wave)
          : [];
        const tmp = {};
        for (const type of list) tmp[type] = (tmp[type] | 0) + 1;
        return tmp;
      })();

  // One-time HUD probe so we see exactly what the panel is using
  console.debug('[HUD preview] wave', wave, 'counts', counts);


  const order = ['villager','squire','knight','hero','engineer','kingsguard','boss'];
  order.forEach((type) => {
    const n = counts[type] | 0;
    if (n <= 0) return;

      let meta = ENEMY_META[type] || { name: type, color: '#ccc', blurb: '' };

  // If this is a boss, specialize the name based on the scheduled boss for this wave.
  if (type === 'boss') {
    const bossId = getBossId(wave);                 // e.g. 'mordred', 'kay', ...
    const displayName = bossId && BOSS_PREVIEW_NAME[bossId];
    if (displayName) {
      meta = { ...meta, name: displayName };        // keep color/blurb, override name
    }

    if (bossId === 'king arthur' || bossId === 'arthur') {
        meta = {
          name:  'Final Battle: King Arthur',
          color: meta.color || '#f4a261',
          blurb: 'The Once and Future King himself. Survive this and you’ve beaten the game.'
        };
      }
  }


    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '28px 1fr auto';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.margin = '6px 0';

        const ICON_SIZE = 24;
    const ico = document.createElement('canvas');
    ico.width = ICON_SIZE;
    ico.height = ICON_SIZE;
    ico.style.width = ICON_SIZE + 'px';
    ico.style.height = ICON_SIZE + 'px';

    const ctx = ico.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;

      // Base radius tuned so the ring fits inside 24×24 nicely
      const radius = ICON_SIZE * 0.34;

      // Use the shared renderer so rings & colors match the battlefield
      drawEnemyGlyph(ctx, ICON_SIZE / 2, ICON_SIZE / 2, type, {
        radius,
        // No per-enemy flags here; the helper will:
        // - Give heroes a shield ring
        // - Give kingsguard a miniboss ring
        // - Give bosses a boss ring
      });
    }


    const txt = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = meta.name;
    title.style.fontWeight = '600';
    const blurb = document.createElement('div');
    blurb.textContent = meta.blurb;
    blurb.style.opacity = '0.85';
    blurb.style.fontSize = '12px';
    txt.appendChild(title);
    txt.appendChild(blurb);

    const pill = document.createElement('div');
    pill.textContent = 'x ' + n;
    pill.style.background = '#1b2437';
    pill.style.border = '1px solid #2a3854';
    pill.style.borderRadius = '999px';
    pill.style.padding = '2px 8px';
    pill.style.fontWeight = '600';

    row.appendChild(ico);
    row.appendChild(txt);
    row.appendChild(pill);
    root.appendChild(row);
  });

  if (!root.children.length) {
    const p = document.createElement('div');
    p.style.opacity = '0.7';
    p.textContent = 'No preview available.';
    root.appendChild(p);
  }
}

// ---------- Dev / Playtest Panel ----------
async function ensureDevPanel() {
  const rightCol = document.getElementById('rightCol');
  if (!rightCol) return;
  if (document.getElementById('devPanel')) return;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'devPanel';

  const title = document.createElement('div');
  title.className = 'pTitle';
  title.textContent = 'Dev / Playtest';
  panel.appendChild(title);

  const row = (node) => { const d = document.createElement('div'); d.style.margin = '6px 0'; d.appendChild(node); panel.appendChild(d); };

  // Infinite money checkbox
  const moneyWrap = document.createElement('label');
  moneyWrap.style.display = 'flex';
  moneyWrap.style.alignItems = 'center';
  moneyWrap.style.gap = '8px';
  const moneyCb = document.createElement('input');
  moneyCb.type = 'checkbox';
  moneyCb.checked = !!state.GameState.dev?.infiniteMoney;
  moneyCb.addEventListener('change', () => {
    state.GameState.dev = state.GameState.dev || {};
    state.GameState.dev.infiniteMoney = moneyCb.checked;
    if (moneyCb.checked) {
      state.GameState.gold  = 1_000_000;
      state.GameState.bones = 1_000_000;
      refreshHUD();
    }
  });
  const moneyLbl = document.createElement('span');
  moneyLbl.textContent = 'Infinite gold & bones';
  moneyWrap.appendChild(moneyCb);
  moneyWrap.appendChild(moneyLbl);
  row(moneyWrap);

  // Grant resources once
  const grantBtn = document.createElement('button');
  grantBtn.className = 'btn';
  grantBtn.textContent = 'Grant 1,000g + 1,000 bones';
  grantBtn.addEventListener('click', () => {
    state.GameState.gold  = (state.GameState.gold  | 0) + 1000;
    state.GameState.bones = (state.GameState.bones | 0) + 1000;
    refreshHUD();
  });
  row(grantBtn);

  // Spawn enemy buttons
  const spawnRow = document.createElement('div');
  spawnRow.style.display = 'grid';
  spawnRow.style.gridTemplateColumns = 'repeat(3, 1fr)';
  spawnRow.style.gap = '6px';

  const types = ['villager','squire','knight','hero','engineer','kingsguard','boss'];
  const combat = await getCombat();

  function addSpawnBtn(type) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `Spawn ${type}`;
    b.addEventListener('click', () => {
      if (typeof combat.devSpawnEnemy === 'function') {
        combat.devSpawnEnemy(state.GameState, type, 1);
        tell(`Spawned ${type}`);
      } else {
        tell('devSpawnEnemy not found in combat.js', '#f88');
      }
    });
    spawnRow.appendChild(b);
  }
  types.forEach(addSpawnBtn);
  row(spawnRow);

  // Utilities row
  const utilRow = document.createElement('div');
  utilRow.style.display = 'flex';
  utilRow.style.gap = '6px';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear Enemies';
  clearBtn.addEventListener('click', async () => {
    const c = await getCombat();
    if (typeof c.devClearEnemies === 'function') {
      c.devClearEnemies(state.GameState);
      tell('Cleared enemies');
    }
  });
  utilRow.appendChild(clearBtn);

  const logBtn = document.createElement('button');
  logBtn.className = 'btn';
  logBtn.textContent = 'Log Enemies';
  logBtn.addEventListener('click', async () => {
    const c = await getCombat();
    if (typeof c.debugEnemy === 'function') {
      console.group('Enemies');
      for (const e of state.GameState.enemies) {
        console.log(c.debugEnemy(e));
      }
      console.groupEnd();
      tell('Enemy debug logged to console');
    } else {
      tell('combat.debugEnemy not available', '#f88');
    }
  });
  utilRow.appendChild(logBtn);

  const setWaveBtn = document.createElement('button');
  setWaveBtn.className = 'btn';
  setWaveBtn.textContent = 'Set Wave…';
  setWaveBtn.addEventListener('click', () => {
    const n = parseInt(prompt('Set current wave number:', String(state.GameState.wave | 0)), 10);
    if (!Number.isNaN(n) && n > 0) {
      state.GameState.wave = n | 0;
      refreshHUD();
      tell(`Wave set to ${n}`);
    }
  });
  utilRow.appendChild(setWaveBtn);

  panel.appendChild(utilRow);

  // === Maze Presets (A/B/C) ===
  const presetTitle = document.createElement('div');
  presetTitle.className = 'pTitle';
  presetTitle.textContent = 'Maze Presets';
  panel.appendChild(presetTitle);

  const PRESET_KEY = 'dl.mazePresets';
  function getPresetMap() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); }
    catch { return {}; }
  }
  function setPresetMap(map) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(map));
  }
  function labelFor(edges) {
    return Array.isArray(edges) ? `${edges.length} edges` : 'empty';
  }

  function makePresetRow(slot) {
    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gridTemplateColumns = 'auto 1fr auto auto auto';
    wrap.style.gap = '6px';
    wrap.style.alignItems = 'center';
    wrap.style.margin = '6px 0';

    const tag = document.createElement('div');
    tag.textContent = `Preset ${slot}`;
    tag.style.opacity = '.8';

    const info = document.createElement('div');
    info.style.fontSize = '12px';
    info.style.opacity = '.75';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const map = getPresetMap();
      map[slot] = state.serializeMaze(state.GameState);
      setPresetMap(map);
      info.textContent = labelFor(map[slot]);
      tell?.(`Saved maze → Preset ${slot}`);
    });

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => {
      const map = getPresetMap();
      const edges = map[slot];
      if (!edges) { tell?.(`Preset ${slot} is empty`, '#f88'); return; }
      state.applyMaze(state.GameState, edges);
      refreshHUD?.();
      tell?.(`Loaded Preset ${slot} (${labelFor(edges)})`);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      const map = getPresetMap();
      if (map[slot]) {
        delete map[slot];
        setPresetMap(map);
      }
      info.textContent = 'empty';
      tell?.(`Deleted Preset ${slot}`);
    });

    const initMap = getPresetMap();
    info.textContent = labelFor(initMap[slot]);

    wrap.appendChild(tag);
    wrap.appendChild(info);
    wrap.appendChild(saveBtn);
    wrap.appendChild(loadBtn);
    wrap.appendChild(delBtn);
    return wrap;
  }

  panel.appendChild(makePresetRow('A'));
  panel.appendChild(makePresetRow('B'));
  panel.appendChild(makePresetRow('C'));

  rightCol.appendChild(panel);
}
