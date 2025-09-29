// combat.js (top)
import * as state from './state.js';
import { updateEnemyDistance, raycastOpenCellsFromExit } from './pathing.js';

// === Ability cooldown timers (module-local) ===
let clawCooldown  = 0;
let gustCooldown  = 0;
let roarCooldown  = 0;
let stompCooldown = 0;

// expose cooldowns for UI
export function getCooldowns() {
  return {
    gust:  Math.max(0, gustCooldown  || 0),
    roar:  Math.max(0, roarCooldown  || 0),
    stomp: Math.max(0, stompCooldown || 0),
  };
}

// Quick helper: any tile adjacent to any dragon cell?
function isAdjacentToDragon(gs, cx, cy) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
  // Manhattan distance 1 to any dragon cell
  for (const c of state.dragonCells(gs)) {
    if (Math.abs(c.x - cx) + Math.abs(c.y - cy) === 1) return true;
  }
  return false;
}

// Push one step along grid if the edge is open (no walls). Returns new (x,y).
function stepIfOpen(gs, x, y, dir) {
  const side = (dir === 'E') ? 'E' : (dir === 'W') ? 'W' : (dir === 'S') ? 'S' : 'N';
  if (!state.isOpen(gs, x, y, side)) return { x, y }; // blocked by wall/out of bounds
  switch (side) {
    case 'E': return { x: x + 1, y };
    case 'W': return { x: x - 1, y };
    case 'S': return { x, y: y + 1 };
    case 'N': return { x, y: y - 1 };
  }
  return { x, y };
}

// Wing Gust: push enemies and bombs away from EXIT by N tiles, respecting walls
function wingGustPush(gs, tiles) {
  const ex = state.EXIT.x, ey = state.EXIT.y;

  // Enemies
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;

    // Choose axis away from EXIT (stronger axis first)
    const dx = e.cx - ex, dy = e.cy - ey;
    let dir;
    if (Math.abs(dx) >= Math.abs(dy)) dir = (dx >= 0) ? 'E' : 'W';
    else                              dir = (dy >= 0) ? 'S' : 'N';

    let nx = e.cx, ny = e.cy;
    for (let k = 0; k < tiles; k++) {
      const step = stepIfOpen(gs, nx, ny, dir);
      if (step.x === nx && step.y === ny) break; // blocked
      nx = step.x; ny = step.y;
    }
    e.cx = nx; e.cy = ny;
  }

  // Bombs (effects.type === 'bomb'): approximate as tile-steps with wall checks
  for (const fx of (gs.effects || [])) {
    if (fx.type !== 'bomb') continue;
    // convert to tile coords
    let cx = Math.floor(fx.x / state.GRID.tile);
    let cy = Math.floor(fx.y / state.GRID.tile);

    const dx = cx - ex, dy = cy - ey;
    let dir;
    if (Math.abs(dx) >= Math.abs(dy)) dir = (dx >= 0) ? 'E' : 'W';
    else                              dir = (dy >= 0) ? 'S' : 'N';

    for (let k = 0; k < tiles; k++) {
      const step = stepIfOpen(gs, cx, cy, dir);
      if (step.x === cx && step.y === cy) break; // blocked
      cx = step.x; cy = step.y;
    }

    // back to pixels (center of the tile)
    fx.x = (cx + 0.5) * state.GRID.tile;
    fx.y = (cy + 0.5) * state.GRID.tile;
  }

  // TODO (nice-to-have FX): add wind streak effect here
}

// Roar: stun + temporary behavior buff within range
function roarAffect(gs, rs) {
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const distMan = Math.abs(e.cx - state.EXIT.x) + Math.abs(e.cy - state.EXIT.y);
    if (distMan <= rs.rangeTiles) {
      e.stunLeft     = Math.max(e.stunLeft || 0, rs.stunSec);
      e.roarBuffLeft = Math.max(e.roarBuffLeft || 0, rs.buffDur);
      e.senseBuff    = rs.senseMult;
      e.herdingBuff  = rs.herdingMult;
      markHit(e, 0.0001);
    }
  }
  // TODO (FX): roar shockwave ring / screen shake
}

// Stomp: low dmg + slow in a big radius
function stompAffect(gs, ss) {
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const distMan = Math.abs(e.cx - state.EXIT.x) + Math.abs(e.cy - state.EXIT.y);
    if (distMan <= ss.rangeTiles) {
      e.hp -= ss.dmg;
      markHit(e, ss.dmg);
      e.slowLeft = Math.max(e.slowLeft || 0, ss.slowSec);
      e.slowMult = Math.min(e.slowMult || 1, ss.slowMult); // strongest slow wins
    }
  }
  // TODO (FX): cracks/dust ring
}

// --- VISUAL: spawn a one-shot mouth fire effect
function spawnMouthFire(gs, dur = 0.6) {
  gs.effects = gs.effects || [];
  gs.effects.push({
    type: 'fireMouth',
    t: 0,          // elapsed seconds
    dur,           // how long the animation runs
    dead: false,   // cleanup flag
  });
}

// --- Spawn helper: give freshly-spawned enemies a "previous cell" (if available)
// and a short forward commit so they don't immediately reconsider direction.
//
// e: enemy object (must already have e.cx, e.cy, e.dir set)
function initializeSpawnPrevAndCommit(e) {
  // Derive a backward offset from the facing direction (dir points where they are heading)
  const dx = (e.dir === 'E' ? 1 : e.dir === 'W' ? -1 : 0);
  const dy = (e.dir === 'S' ? 1 : e.dir === 'N' ? -1 : 0);

  // prev cell is one step behind current position
  const prevX = e.cx - dx;
  const prevY = e.cy - dy;

  if (Number.isInteger(prevX) && Number.isInteger(prevY) && state.inBounds(prevX, prevY)) {
    e.prevCX = prevX;
    e.prevCY = prevY;
  }

  // Give a short commitment so the first few steps are forced straight.
  // This prevents immediate decision logic at the spawn tile (esp. at edges).
  e.commitDir = e.dir;
  // 2 steps is a conservative default; increase to 3 if you want stronger initial straight bias.
  e.commitSteps = Math.max(e.commitSteps || 0, 2);
}

// Return nearest dragon cell (tile coords) to a given tile (ox, oy)
function nearestDragonCell(gs, ox, oy) {
  const cells = state.dragonCells(gs); // assumes you exported this from state.js
  let best = cells[0], bestD2 = Infinity;
  for (const c of cells) {
    const dx = c.x - ox, dy = c.y - oy;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  return best;
}


/* =========================
 * Enemy templates & scaling
 * ========================= */

const CURVES = {
  // Bases per type
  hpBase:       { villager: 12,  squire: 16,  knight: 45,  hero: 65, engineer: 40, kingsguard: 90, boss: 300 },
  spdBase:      { villager: 1.6, squire: 1.7, knight: 2.5, hero: 1.8, engineer: 2.0, kingsguard: 2.2, boss: 2.0 },
  dmgBase:      { villager: 8,   squire: 10,  knight: 14,  hero: 16, engineer: 20, kingsguard: 28, boss: 40 },

  // Caps relative to base (your request):
  // speed: 2×, hp: 10×, damage: 1.5×
  hpCapMult:   10.0,
  spdCapMult:   2.0,
  dmgCapMult:   1.5,

  // How quickly each stat approaches its cap (tune to taste)
  // Larger k => reaches the cap sooner.
  kHP:   0.06,
  kSPD:  0.03,
  kDMG:  0.05,
};


// How each unit tends to decide at junctions
const BEHAVIOR = {
  villager:  { sense: 0.02, herding: 2.00, curiosity: 0.55 },
  squire:    { sense: 0.3, herding: 1.40, curiosity: 0.15 },
  knight:    { sense: 0.45, herding: 0.50, curiosity: 0.10 },
  hero:      { sense: 0.80, herding: 0.20, curiosity: 0.05 },
  engineer:  { sense: 0.90, herding: 0.50, curiosity: 0.07 },
  kingsguard:{ sense: 1.50, herding: 0.10, curiosity: 0.01 },
  boss:      { sense: 2.00, herding: 0.00, curiosity: 0.00 },
};

const FLAGS = {
  kingsguardEvery: 5,        // miniboss cadence
  bossEvery: 10,             // Knight of the Round Table cadence
  engineerBombTimer: 5,     // seconds until detonation
  engineerTravelTime: 4.0,   // seconds "digging" underground before popping up
  engineerBombDmg: 35,       // damage to the dragon on bomb detonation
  spawnGap: 0.45,            // seconds between spawns
};

function waveCountFor(wave) {
  const base = 7;          // wave 1 size
  const cap  = 70;         // hard-ish ceiling you wanted (~50)
  const k    = 0.07;       // growth tempo
  return Math.max(1, Math.round(approachCap(base, cap, wave, k)));
}

// Smooth asymptotic growth: starts near `base`, rises quickly early,
// then slows and approaches `cap` as wave → ∞.
// k is the “tempo” (higher k = reaches the cap faster).
function approachCap(base, cap, wave, k) {
  const w = Math.max(0, (wave | 0) - 1);
  return cap - (cap - base) * Math.exp(-k * w);
}

function makeEnemy(type, wave) {
  const hp0  = CURVES.hpBase[type];
  const spd0 = CURVES.spdBase[type];
  const dmg0 = CURVES.dmgBase[type];

  // Approach caps per your spec
  const hp   = Math.round(approachCap(hp0,  hp0  * CURVES.hpCapMult,  wave, CURVES.kHP));
  const spd  =           approachCap(spd0, spd0 * CURVES.spdCapMult, wave, CURVES.kSPD);
  const tDmg = Math.round(approachCap(dmg0, dmg0 * CURVES.dmgCapMult, wave, CURVES.kDMG));
  
  const leaderTypes = new Set(['hero', 'kingsguard', 'boss']);
  const trailStrength = leaderTypes.has(type) ? 2.5 : 0.5; // tune these
  
  // --- per-type attack tuning (range in tiles, attacks/sec, damage per hit)
  const ATTACK_PROFILE = {
    villager:   { range: 1, rate: 0.45, dmg: Math.max(1, Math.round(tDmg * 0.4)) },
    squire:     { range: 1, rate: 0.5, dmg: Math.round(tDmg * 0.5) },
    knight:     { range: 1, rate: 0.7,  dmg: Math.round(tDmg * 0.7) },
    hero:       { range: 1, rate: 1.0,  dmg: Math.round(tDmg * 1.0) },
    engineer:   { range: 1, rate: 0.01,  dmg: Math.round(tDmg * 0.1) }, // engineers still plant bombs
    kingsguard: { range: 1, rate: 0.5,  dmg: Math.round(tDmg * 1.2) },
    boss:       { range: 1, rate: 0.3,  dmg: Math.round(tDmg * 1.7)  },
  };
  const prof = ATTACK_PROFILE[type] || { range: 1, rate: 0.8, dmg: tDmg };

  const base = {
    type,
    name: type,
    hp,
    maxHp: hp,
    speed: spd,             // tiles/sec
    contactDamage: tDmg,    // legacy
    attackDamage: prof.dmg,
    attackRate: prof.rate,
    attackRange: prof.range,
    attackTimer: Math.random() * (1 / Math.max(0.0001, prof.rate)), // jitter so not every attacker hits same frame
    pausedForAttack: false,
    shield: false,
    miniboss: false,
    burnLeft: 0,
    burnDps: 0,
    updateByCombat: false,
    lastHitAt: 0,
    showHpUntil: 0,
    behavior: BEHAVIOR[type] || { sense: 0.5, herding: 1.0, curiosity: 0.12 },
    isLeader: leaderTypes.has(type),
    trailStrength,
  };

  // (keep your existing switch with names/flags)
  switch (type) {
    case 'villager':   return { ...base, name: 'Villager' };
    case 'squire':     return { ...base, name: 'Squire' };
    case 'knight':     return { ...base, name: 'Knight' };
    case 'hero':       return { ...base, name: 'Hero', shield: true };
    case 'engineer':   return { ...base, name: 'Engineer', tunneling: true, tunnelT: FLAGS.engineerTravelTime, updateByCombat: true };
    case 'kingsguard': return { ...base, name: "King's Guard", miniboss: true };
    case 'boss':       return { ...base, name: 'Knight of the Round Table', miniboss: true };
    default:           return base;
  }
}

/* =========================
 * Spawning
 * ========================= */

function spawnOne(gs, type) {
  const e = makeEnemy(type, gs.wave | 0);
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';

  // initialize prev/commit so freshly-spawned enemies head straight initially
  initializeSpawnPrevAndCommit(e);

  gs.enemies.push(e);

  // seed an initial trail at the spawn tile so followers can latch on quickly
  if (typeof e.trailStrength === 'number') {
    // dynamic import avoids cyclic top-level import problems if pathing isn't imported here
    import('./pathing.js').then(m => {
      if (typeof m.bumpSuccess === 'function') m.bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
    }).catch(() => {
      // swallow failure silently in dev builds; not critical
    });
  }
}

/* --- Dev / Playtest helpers --- */
export function devSpawnEnemy(gs = state.GameState, type = 'villager', n = 1) {
  n = Math.max(1, n | 0);
  for (let i = 0; i < n; i++) {
    const e = makeEnemy(type, gs.wave | 0);
    e.cx = state.ENTRY.x;
    e.cy = state.ENTRY.y;
    e.dir = 'E';
    initializeSpawnPrevAndCommit(e);
    gs.enemies.push(e);
    // seed trail immediately for dev-spawned units too
    if (typeof e.trailStrength === 'number') {
      import('./pathing.js').then(m => {
        if (typeof m.bumpSuccess === 'function') m.bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
      }).catch(() => {});
    }
  }
}

export function devClearEnemies(gs = state.GameState) {
  gs.enemies = [];
}

// Dev helper: return compact per-enemy debug info
export function debugEnemy(e) {
  return {
    type: e.type,
    cx: e.cx, cy: e.cy,
    x: e.x, y: e.y,
    dir: e.dir,
    distFromEntry: e.distFromEntry,
    tunneling: !!e.tunneling,
    hp: e.hp,
    updateByCombat: !!e.updateByCombat,
  };
}

// Module runtime state for the spawner / wave system
// (keeps spawn queue/timer and whether a wave is active)
const R = {
  spawning: false,
  queue: [],
  spawnTimer: 0,
  waveActive: false,
};
// module-scope breath cooldown (must be top-level)
let fireCooldown = 0;

/**
 * Dragon breath tick:
 * - builds a reachable path of tiles from the EXIT (via raycastOpenCellsFromExit)
 * - finds the nearest reachable enemy on that path
 * - spawns a flameWave effect for visuals
 * - applies damage on a cadence (fireCooldown)
 *
 * ds should be getDragonStats(gs) (precomputed caller-side is fine).
 */
function dragonBreathTick(gs, dt, ds) {
  // manage the visual/attack cadence
  fireCooldown = Math.max(0, fireCooldown - dt);
  const firePeriod = 1 / Math.max(0.0001, ds.fireRate);

  // 1) Build path out to breath range, along open cells from EXIT (no walls).
  const maxTiles = Math.max(1, Math.round(ds.breathRange / state.GRID.tile));
  const path = raycastOpenCellsFromExit(gs, maxTiles);
  if (!path || path.length === 0) {
    if (gs.dragonFX) { gs.dragonFX.attacking = false; gs.dragonFX.t = 0; }
    return;
  }

  // helpers for tile indexing
  const key = (x, y) => state.tileKey(x, y);
  const indexByKey = new Map();
  for (let i = 0; i < path.length; i++) indexByKey.set(key(path[i].x, path[i].y), i);
  const pathKeys = new Set(indexByKey.keys());

  // 2) Find the NEAREST *reachable* enemy on that path (ignore tunneling)
  let nearestIdx = Infinity;
  for (const e of gs.enemies) {
    if (e.type === 'engineer' && e.tunneling) continue; // ignore underground
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const k = key(e.cx, e.cy);
    if (!pathKeys.has(k)) continue;
    const idx = indexByKey.get(k);
    if (idx !== undefined && idx < nearestIdx) nearestIdx = idx;
  }

  // No reachable enemy -> stop anim, no damage.
  if (!isFinite(nearestIdx)) {
    gs.dragonFX = gs.dragonFX || { attacking: false, t: 0, dur: 0.25 };
    gs.dragonFX.attacking = false;
    gs.dragonFX.t = 0;
    return;
  }

  // 3) Sustain mouth animation while someone reachable is in range
  gs.dragonFX = gs.dragonFX || { attacking: false, t: 0, dur: 0.25 };
  if (!gs.dragonFX.attacking) {
    gs.dragonFX.attacking = true;
    gs.dragonFX.t = 0;
    gs.dragonFX.dur = 0.25;
  }

  // 4) Visual: spawn a traveling flame wave limited to the nearest enemy
  const truncatedPath = path.slice(0, Math.min(path.length, nearestIdx + 1));
  (gs.effects || (gs.effects = [])).push({
    type: 'flameWave',
    path: truncatedPath,
    headIdx: 0,
    t: 0,
    dur: 0.7,
    tilesPerSec: 16,
    widthPx: state.GRID.tile * 0.85,
  });

  // 5) Only DEAL DAMAGE on fire-rate ticks; still target only tiles up to nearest enemy
  if (fireCooldown > 0) return;

  // Shield line: heroes closer to ENTRY than other enemies shield them
  let maxHeroDist = -1;
  for (const h of gs.enemies) {
    if (h.type === 'hero' && isFinite(h.distFromEntry)) {
      if (h.distFromEntry > maxHeroDist) maxHeroDist = h.distFromEntry;
    }
  }
  const shieldedByHero = (e) =>
    (maxHeroDist >= 0) &&
    isFinite(e.distFromEntry) &&
    (e.distFromEntry < maxHeroDist);

  // Apply damage to enemies on truncated path (reachable up to nearest)
  const hitUpToNearest = new Set(truncatedPath.map(s => key(s.x, s.y)));
  for (const e of gs.enemies) {
    if (!e || (e.type === 'engineer' && e.tunneling)) continue;
    if (!hitUpToNearest.has(key(e.cx, e.cy))) continue;

    const isHero   = (e.type === 'hero');
    const shielded = shieldedByHero(e);

    // Your requested rules:
    // - Hero never takes direct fire but DOES take burn
    // - Followers shielded by a hero take no direct, no burn
    // - Followers not shielded take both direct and burn
    const canTakeDirect = !isHero && !shielded;
    const canTakeBurn   =  isHero || !shielded;

    if (canTakeDirect) {
      e.hp -= ds.breathPower;
      markHit(e, ds.breathPower);
    }
    if (canTakeBurn && ds.burnDPS > 0 && ds.burnDuration > 0) {
      e.burnDps  = ds.burnDPS;
      e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
      // ensure HP bar shows even if this tick was burn-only
      if (!canTakeDirect) markHit(e, 0.0001);
    }
  }

  // Reset fire cooldown to cadence
  fireCooldown = firePeriod;
}


/* small helpers used elsewhere in this module */

// simple in-place Fisher–Yates shuffle (used by engineer spawn spots)
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// mark an enemy as recently hit (controls HP bar visibility + timestamp)
function markHit(e, amount = 0) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  e.lastHitAt = now;
  e.showHpUntil = now + 1000; // visible for 1s since last damage tick
}

// ---------------- Wave composition + start ----------------

function buildWaveQueue(gs = state.GameState) {
  const wave = (gs.wave | 0) || 1;
  const n = Math.max(1, waveCountFor(wave));
  const q = [];

  // Specials first (optional cadence)
  if (wave % FLAGS.bossEvery === 0)       q.push('boss');
  if (wave % FLAGS.kingsguardEvery === 0) q.push('kingsguard');
  if (wave >= 4 && wave % 4 === 0)        q.push('hero');       // a hero every 4 waves (tune)

  // Light engineers occasionally (bomb planters)
  if (wave >= 5 && wave % 3 === 0) q.push('engineer');

  // Fill the rest with core troops (simple progression)
  const remaining = Math.max(0, n - q.length);
  for (let i = 0; i < remaining; i++) {
    if (wave < 4) {
      q.push('villager');
    } else if (wave < 8) {
      q.push((i % 3 === 0) ? 'squire' : 'villager');
    } else {
      // knights come in more often later
      q.push((i % 2 === 0) ? 'knight' : 'squire');
    }
  }

  // Small shuffle so batches aren't too uniform (keeps first element stable)
  for (let i = 1; i < q.length; i++) {
    const j = 1 + ((Math.random() * (q.length - 1)) | 0);
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q;
}

export function startWave(gs = state.GameState) {
  // prevent re-entrancy while a wave is active or still spawning
  if (R.waveActive || R.spawning || (R.queue && R.queue.length > 0)) return false;

  // ensure containers
  gs.enemies = gs.enemies || [];
  gs.effects = gs.effects || [];

  // build queue and flip flags
  R.queue = buildWaveQueue(gs);
  R.spawning = true;
  R.waveActive = true;
  R.spawnTimer = 0; // spawn immediately on next update tick

  return true;
}

// Back-compat export if main.js ever uses spawnWave
export const spawnWave = startWave;

/* =========================
 * Update loop
 * ========================= */

 export function update(gs = state.GameState, dt) {
  const enemies = gs.enemies || (gs.enemies = []);
  gs.effects = gs.effects || []; // bombs

  // ---- Success-trail global decay (fade the herd trail each frame) ----
  const T = gs.successTrail;
  if (T) {
    const decayPerSec = 0.6;    // <--- tweak this number to taste
    const mul = Math.max(0, 1 - decayPerSec * dt);
    for (let y = 0; y < T.length; y++) {
      const row = T[y];
      for (let x = 0; x < row.length; x++) {
        row[x] = row[x] * mul;
        if (row[x] < 1e-4) row[x] = 0;
      }
    }
  }

  // 1) Spawning
  if (R.spawning && R.queue.length > 0) {
    R.spawnTimer -= dt;
    if (R.spawnTimer <= 0) {
      spawnOne(gs, R.queue.shift());
      R.spawnTimer = FLAGS.spawnGap;
    }
  }

  // 2) Enemy status (engineer tunneling, burn DoT, deaths, contact/attack)
  const exitCx = state.EXIT.x, exitCy = state.EXIT.y;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    updateEnemyDistance(gs, e);

    // Engineers: tunneling -> pop near dragon -> plant bomb
    if (e.type === 'engineer' && e.tunneling) {
      e.tunnelT -= dt;
      if (e.tunnelT <= 0) {
        const spots = shuffle([
          { x: exitCx - 1, y: exitCy },
          { x: exitCx + 1, y: exitCy },
          { x: exitCx,     y: exitCy - 1 },
          { x: exitCx,     y: exitCy + 1 },
        ]).filter(p => state.inBounds(p.x, p.y));
        const spot = spots[0] || { x: exitCx, y: exitCy };
        e.cx = spot.x; e.cy = spot.y; e.dir = 'W';
        e.tunneling = false;

        // Plant bomb at dragon perimeter (or center of nearest dragon cell)
        const PLACE_MODE = 'perimeter'; // 'perimeter' | 'center'
        const t  = state.GRID.tile;
        const dc = nearestDragonCell(gs, e.cx, e.cy);

        // Center of that dragon tile
        const cx = (dc.x + 0.5) * t;
        const cy = (dc.y + 0.5) * t;

        let bx = cx, by = cy;
        if (PLACE_MODE === 'perimeter') {
          // Place along the line from dragon center toward the engineer, at the tile edge
          const ex = (e.cx + 0.5) * t;
          const ey = (e.cy + 0.5) * t;
          const dx = ex - cx, dy = ey - cy;
          const L  = Math.hypot(dx, dy) || 1;
          const halfTile = t * 0.5;
          bx = cx + (dx / L) * halfTile;
          by = cy + (dy / L) * halfTile;
        }

        gs.effects.push({
          type: 'bomb',
          x: bx,
          y: by,
          timer: FLAGS.engineerBombTimer,
          dmg: FLAGS.engineerBombDmg,
        });
      }
    }

    // Ability cooldowns tick
    clawCooldown  = Math.max(0, clawCooldown  - dt);
    gustCooldown  = Math.max(0, gustCooldown  - dt);
    roarCooldown  = Math.max(0, roarCooldown  - dt);
    stompCooldown = Math.max(0, stompCooldown - dt);

    // Burn DoT (burn always ticks; shield only blocks direct fire)
    if (e.burnLeft > 0 && e.burnDps > 0) {
      const tick = Math.min(dt, e.burnLeft);
      e.burnLeft -= tick;
      e.hp -= e.burnDps * tick;
      markHit(e, e.burnDps * tick);
    }

    // Stun/slow/roar-buff timers
    if (e.stunLeft > 0) e.stunLeft -= dt;
    if (e.slowLeft > 0) e.slowLeft -= dt;
    if (e.roarBuffLeft > 0) e.roarBuffLeft -= dt;

    // --- NEW: attack-over-time logic (pause movement + tick attacks) ---
    // If enemy is within attackRange (manhattan) of nearest dragon cell, attack.
    if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
      const nearest = nearestDragonCell(gs, e.cx, e.cy);
      if (nearest) {
        const distMan = Math.abs(nearest.x - e.cx) + Math.abs(nearest.y - e.cy);
        const range = (typeof e.attackRange === 'number') ? e.attackRange : 1;
        if (distMan <= range) {
          
          // Pause movement and attack over time
          e.pausedForAttack = true;
          e.isAttacking = true;
          e.attackTimer = e.attackTimer ?? (Math.random() * (1 / Math.max(1e-6, e.attackRate || 1)));
          e.attackTimer -= dt;

          const rate = Math.max(1e-6, e.attackRate || 1);
          if (e.attackTimer <= 0) {
            const dmg = (typeof e.attackDamage === 'number') ? e.attackDamage : (e.contactDamage | 0);
            gs.dragonHP = Math.max(0, gs.dragonHP - (dmg | 0));
            markHit(e, dmg);
            // reset to next attack interval
            e.attackTimer += 1 / rate;
          }

          // do NOT auto-despawn here — death happens naturally below if hp <= 0
        } else {
          // Not in range -> resume movement
          e.pausedForAttack = false;
          e.isAttacking = false;
        }
      }
    }

    // Death -> rewards (DoT, projectiles, or other effects may have killed them)
    if (e.hp <= 0) {
      gs.gold  = (gs.gold  | 0) + 5;
      gs.bones = (gs.bones | 0) + 1;
      enemies.splice(i, 1);
      continue;
    }

    // --- Legacy contact: if an enemy actually steps *into* a dragon cell (rare),
    //     still apply a contact hit but don't assume death-on-contact. Keep it small.
    if (
      Number.isInteger(e.cx) && Number.isInteger(e.cy) &&
      state.isDragonCell(e.cx, e.cy, gs)
    ) {
      // If somehow inside dragon hitbox, inflict a single chunk of damage and remove:
      // (This keeps old behavior if something forces an enemy into dragon cells.)
      gs.dragonHP = Math.max(0, gs.dragonHP - (e.contactDamage | 0));
      enemies.splice(i, 1);
      continue;
    }
  }

  // 3) Bomb timers
  for (let i = gs.effects.length - 1; i >= 0; i--) {
    const fx = gs.effects[i];
    if (fx.type !== 'bomb') continue;
    fx.timer -= dt;
    if (fx.timer <= 0) {
      gs.dragonHP = Math.max(0, gs.dragonHP - (fx.dmg | 0));
      gs.effects.splice(i, 1);
    }
  }

  // --- Claw: high dmg melee, auto when any adjacent enemy exists (gated by CD)
  {
    const cs = state.getClawStats(gs);
    if (clawCooldown <= 0) {
      let hitAny = false;
      // strike any enemy in a tile adjacent to the dragon footprint
      for (let i = gs.enemies.length - 1; i >= 0; i--) {
        const e = gs.enemies[i];
        if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
        if (isAdjacentToDragon(gs, e.cx, e.cy)) {
          e.hp -= cs.dmg;
          markHit(e, cs.dmg);
          hitAny = true;
          // optional: add a slash FX in render using gs.effects
          if (e.hp <= 0) {
            gs.gold  = (gs.gold  | 0) + 5;
            gs.bones = (gs.bones | 0) + 1;
            gs.enemies.splice(i, 1);
          }
        }
      }
      if (hitAny) clawCooldown = cs.cd;
    }
  }

  // --- Wing Gust (button request → push away, respect walls)
  if (gs.reqWingGust && gustCooldown <= 0) {
    gs.reqWingGust = false;
    const ps = state.getGustStats(gs);
    wingGustPush(gs, ps.pushTiles);
    gustCooldown = ps.cd;
  }

  // --- Roar (button request → stun + fear buffs)
  if (gs.reqRoar && roarCooldown <= 0) {
    gs.reqRoar = false;
    const rs = state.getRoarStats(gs);
    roarAffect(gs, rs);
    roarCooldown = rs.cd;
  }

  // --- Stomp (button request → AoE slow + chip dmg)
  if (gs.reqStomp && stompCooldown <= 0) {
    gs.reqStomp = false;
    const ss = state.getStompStats(gs);
    stompAffect(gs, ss);
    stompCooldown = ss.cd;
  }

  // 4) Dragon breath (with shield rule)
  if (enemies.length > 0) {
    dragonBreathTick(gs, dt, state.getDragonStats(gs));
  }

  // 5) Wave completion
  if (R.waveActive && R.queue.length === 0 && enemies.length === 0) {
    R.waveActive = false;
    R.spawning = false;
    gs.wave = (gs.wave | 0) + 1;
  }
}
