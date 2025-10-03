// combat.js (top)
import * as state from './state.js';
import { updateEnemyDistance, raycastOpenCellsFromExit } from './pathing.js';
import { getCfg } from './state.js';

// === Ability cooldown timers (module-local) ===
// Initialized to 0; abilities will set cooldowns from cfg on use (ps.cd),
// and you may also reset them at wave start if desired.
let gustCooldown  = 0;
let roarCooldown  = 0;
let stompCooldown = 0;
let clawCooldown  = 0;


// Unique enemy IDs (module-local counter)
let __ENEMY_ID = 0;

// expose cooldowns for UI
export function getCooldowns() {
  return {
    gust:  Math.max(0, gustCooldown  || 0),
    roar:  Math.max(0, roarCooldown  || 0),
    stomp: Math.max(0, stompCooldown || 0),
    claw:  Math.max(0, clawCooldown  || 0),
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

// Wing Gust: push ONLY adjacent enemies away from EXIT by N tiles, respecting walls,
// then have them resume moving back toward the EXIT (dragon).
function wingGustPush(gs, tiles) {
  // compute a stable dragon anchor once
  const cells = state.dragonCells(gs);
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const ax = Math.round(sx / Math.max(1, cells.length));
  const ay = Math.round(sy / Math.max(1, cells.length));

  // ----- Enemies -----
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;

    // Only push units adjacent to the dragon
    if (!isAdjacentToDragon(gs, e.cx, e.cy)) continue;

    // Pick push direction away from dragon anchor on the dominant axis
    const dx0 = e.cx - ax, dy0 = e.cy - ay;
    let dir;
    if (Math.abs(dx0) >= Math.abs(dy0)) dir = (dx0 >= 0) ? 'E' : 'W';
    else                                dir = (dy0 >= 0) ? 'S' : 'N';

    // Step out up to N tiles, respecting walls; do not land inside dragon
    let nx = e.cx, ny = e.cy;
    for (let k = 0; k < tiles; k++) {
      const step = stepIfOpen(gs, nx, ny, dir);
      if (step.x === nx && step.y === ny) break;    // blocked
      if (state.isDragonCell(step.x, step.y, gs)) break; // don't shove into dragon
      nx = step.x; ny = step.y;
    }

    if (nx !== e.cx || ny !== e.cy) {
      e.cx = nx; e.cy = ny;

      // Lightly bias next movement back toward EXIT/dragon
      const dx = state.EXIT.x - nx, dy = state.EXIT.y - ny;
      const toExit = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : (dy >= 0 ? 'S' : 'N');
      const v = { E:[1,0], W:[-1,0], S:[0,1], N:[0,-1] }[toExit];

      // Set heading history so AI infers facing → toward EXIT
      e.prevCX = nx - v[0];
      e.prevCY = ny - v[1];
      e.dir = toExit;            // keep dir consistent with that heading
      e.commitDir = null;        // let normal pathing resume immediately
      e.commitSteps = 0;
      e.isAttacking = false;
      e.pausedForAttack = false;
    }
  }

  // ----- Bombs (optional): keep your existing bomb push logic, or restrict to adjacency similarly -----
  for (const fx of (gs.effects || [])) {
    if (fx.type !== 'bomb') continue;
    // (your existing bomb tile-step code is fine; you can also gate it by adjacency if you want)
    let cx = Math.floor(fx.x / state.GRID.tile);
    let cy = Math.floor(fx.y / state.GRID.tile);

    const dx = cx - ax, dy = cy - ay;
    let dir;
    if (Math.abs(dx) >= Math.abs(dy)) dir = (dx >= 0) ? 'E' : 'W';
    else                              dir = (dy >= 0) ? 'S' : 'N';

    for (let k = 0; k < tiles; k++) {
      const step = stepIfOpen(gs, cx, cy, dir);
      if (step.x === cx && step.y === cy) break;
      cx = step.x; cy = step.y;
    }

    const t = state.GRID.tile;
    fx.x = (cx + 0.5) * t;
    fx.y = (cy + 0.5) * t;
  }
}


function dragonAnchor(gs) {
  const cells = state.dragonCells(gs);
  // simple centroid of dragon tiles
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  const cx = Math.round(sx / Math.max(1, cells.length));
  const cy = Math.round(sy / Math.max(1, cells.length));
  return { cx, cy };
}

// Roar: stun + temporary behavior buff within range
function roarAffect(gs, rs) {
  const a = dragonAnchor(gs);
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const distMan = Math.abs(e.cx - a.cx) + Math.abs(e.cy - a.cy);
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
  const a = dragonAnchor(gs);
  for (const e of gs.enemies) {
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const distMan = Math.abs(e.cx - a.cx) + Math.abs(e.cy - a.cy);
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

function nextGroupSize() {
  const a = FLAGS.groupMin | 0, b = FLAGS.groupMax | 0;
  if (b <= a) return Math.max(1, a);
  const r = a + ((Math.random() * (b - a + 1)) | 0);
  return Math.min(Math.max(1, r), b);
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
  spdBase:      { villager: 1, squire: 1.1, knight: 2, hero: 1.2, engineer: 1.15, kingsguard: 1.8, boss: 1.6 },
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
  spawnGap: 0.45,          // time between members in a group
  groupGap: 2.0,           // extra pause between groups
  groupMin: 6,
  groupMax: 10,
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
    damage: prof.dmg,
    range: prof.range,
    rate: prof.rate,
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
   let out;
  switch (type) {
    case 'villager':   out = { ...base, name: 'Villager' }; break;
    case 'squire':     out = { ...base, name: 'Squire' }; break;
    case 'knight':     out = { ...base, name: 'Knight' }; break;
    case 'hero':       out = { ...base, name: 'Hero', shield: true }; break;
    case 'engineer':   out = { ...base, name: 'Engineer', tunneling: true, tunnelT: FLAGS.engineerTravelTime, updateByCombat: true }; break;
    case 'kingsguard': out = { ...base, name: "King's Guard", miniboss: true }; break;
    case 'boss':       out = { ...base, name: 'Knight of the Round Table', miniboss: true }; break;
    default:           out = base; break;
  }

  // --- Phase 5: apply per-type overrides from cfg.enemies[type], if present ---
  const cfg = state.getCfg?.(state.GameState) || state.getCfg?.(state.GameState);
  const ov = cfg?.enemies?.[type];
  if (ov && typeof ov === 'object') {
    if (typeof ov.hp === 'number')      { out.hp = Math.max(1, ov.hp|0); out.maxHp = out.hp; }
    if (typeof ov.speed === 'number')   { out.speed = ov.speed; }
    if (typeof ov.damage === 'number') {
  out.damage = ov.attackDamage;
}
    if (typeof ov.rnge === 'number') {
  out.range = ov.range;
}
    if (typeof ov.rate === 'number') { out.rate = ov.rate;
  out.attackTimer = Math.random() * (1 / Math.max(0.0001, out.rate));
}
    if (typeof ov.armor === 'number')   { out.armor = ov.armor|0; }
    if (typeof ov.gold === 'number')    { out.gold  = ov.gold|0; }
    if (typeof ov.bones === 'number')   { out.bones = ov.bones|0; }
    if (typeof ov.shielded === 'boolean'){ out.shield = !!ov.shielded; }
    if (Array.isArray(ov.tags))         { out.tags = [...ov.tags]; }
    if (typeof ov.size === 'number')    { out.size = ov.size; }
    if (typeof ov.sprite === 'string')  { out.sprite = ov.sprite; }
  }
  return out;
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

function spawnOneIntoGroup(gs, type, groupId, currentLeaderId) {
  const e = makeEnemy(type, gs.wave | 0);
  e.id = (++__ENEMY_ID);
  e.groupId = groupId | 0;
  e.routeSeed = e.routeSeed ?? ((Math.random() * 1e9) | 0);
  e.cx = state.ENTRY.x;
  e.cy = state.ENTRY.y;
  e.dir = 'E';

  // force torch for special roles; they can overwrite leader visually, but we keep the first as leader
  if (e.type === 'hero' || e.type === 'kingsguard' || e.type === 'boss') {
    e.torchBearer = true;
    e.behavior.sense = (e.behavior.sense || 0.5) * 1.15;
    e.trailStrength = Math.max(e.trailStrength || 0.5, 1.5);
  }

  // Each member follows the current group leader (set after the first spawn)
  e.followLeaderId = currentLeaderId ?? null;

  initializeSpawnPrevAndCommit(e);
  (gs.enemies || (gs.enemies = [])).push(e);

  // seed trail: helps bunching
  if (typeof e.trailStrength === 'number') {
    import('./pathing.js').then(m => {
      if (typeof m.bumpSuccess === 'function') m.bumpSuccess(gs, e.cx, e.cy, e.trailStrength);
    }).catch(() => {});
  }
  return e;
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
  
  // new
  groupId: 0,
  groupRemaining: 0,
  groupLeaderId: null,
};

// --- Phase 5: JSON wave plan (null when not using JSON-driven waves) ---
let _jsonPlan = null; // { groups: [{ type, remaining, interval, nextAt }], startedAt }

// Warn once per wave per unknown type referenced by waves.json
let _warnedTypesThisWave = new Set();

// module-scope breath cooldown (must be top-level)
let fireCooldown = 0;

// module-scope accumulator for throttled trail decay (top-level)
let trailDecayAccum = 0;
/**
 * Dragon breath tick:
 * - builds a reachable path of tiles from the EXIT (via raycastOpenCellsFromExit)
 * - finds the nearest reachable enemy on that path
 * - spawns a flameWave effect for visuals
 * - applies damage on a cadence (fireCooldown)
 *
 * ds should be getDragonStats(gs) (precomputed caller-side is fine).
 */
// module-scope breath cooldown (already declared above): let fireCooldown = 0;
function dragonBreathTick(gs, dt, ds) {
  // cooldown ticks down
  fireCooldown = Math.max(0, fireCooldown - dt);
  const firePeriod = 1 / Math.max(0.0001, ds.fireRate);

  // We only start a new BREATH when cooldown hits 0.
  if (fireCooldown > 0) return;

  // --- Build path from EXIT up to range (no walls) ---
  const maxTiles = Math.max(1, Math.round(ds.breathRange / state.GRID.tile));
  const path = raycastOpenCellsFromExit(gs, maxTiles);
  if (!path || path.length === 0) {
    // nothing to do, reset cooldown so we won't retry every frame
    fireCooldown = firePeriod * 0.25;
    return;
  }

  // Fast index for tiles in path
  const key = (x, y) => state.tileKey(x, y);
  const indexByKey = new Map();
  for (let i = 0; i < path.length; i++) indexByKey.set(key(path[i].x, path[i].y), i);

  // Find nearest *reachable* enemy on the path
  let nearestIdx = Infinity;
  for (const e of gs.enemies) {
    if (e.type === 'engineer' && e.tunneling) continue;
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const k = key(e.cx, e.cy);
    if (!indexByKey.has(k)) continue;
    const idx = indexByKey.get(k);
    if (idx < nearestIdx) nearestIdx = idx;
  }

  // If no target in range, we still put the breath on cooldown (small penalty)
  if (!isFinite(nearestIdx)) {
    fireCooldown = firePeriod * 0.5;
    return;
  }

  // ---- Shield block: if a Hero sits on the path, stop visuals (and direct dmg) there
  // Find the FIRST hero index along the path (closest to dragon)
  let heroBlockIdx = Infinity;
  for (const e of gs.enemies) {
    if (e.type !== 'hero') continue;
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;
    const idx = indexByKey.get(key(e.cx, e.cy));
    if (idx !== undefined && idx < heroBlockIdx) heroBlockIdx = idx;
  }

  // The visual wave should end at:
  // - the nearest target, unless a hero is even closer; then end at the hero.
  const visualEndIdx = Math.min(nearestIdx, heroBlockIdx);
  const truncatedPath = path.slice(0, Math.min(path.length, visualEndIdx + 1));

  // --- Spawn the one-shot mouth animation (short)
  gs.dragonFX = { attacking: true, t: 0, dur: 0.25 };

  // --- Spawn a flame wave that continues traveling even after mouth stops
  // Make duration long enough to traverse its truncated path (plus fade tail)
  const tilesPerSec = 14; // travel speed of flame head
  const travelSec = truncatedPath.length / Math.max(1, tilesPerSec);
  (gs.effects || (gs.effects = [])).push({
    type: 'flameWave',
    path: truncatedPath,     // array of {x,y,dir?} from your pathing
    headIdx: 0,
    t: 0,
    tilesPerSec,
    widthPx: state.GRID.tile * 0.85,
    dur: travelSec + 0.6,    // +fade tail time
  });

  // --- If hero blocked, add a short "splash" effect at that tile
  const blockedByHero = (heroBlockIdx <= nearestIdx);
  if (blockedByHero && isFinite(heroBlockIdx)) {
    const hit = path[heroBlockIdx];
    (gs.effects || (gs.effects = [])).push({
      type: 'fireSplash',
      x: (hit.x + 0.5) * state.GRID.tile,
      y: (hit.y + 0.5) * state.GRID.tile,
      t: 0,
      dur: 0.35,
    });
  }

  // --- Apply damage ONCE per breath:
  //   - Direct+burn to enemies on tiles up to nearestIdx
  //   - But if heroBlockIdx < nearestIdx, direct is stopped at hero (no direct past it),
  //     and hero takes ONLY burn (your rule).
  const hitSet = new Set(path.slice(0, Math.min(path.length, nearestIdx + 1)).map(s => key(s.x, s.y)));

  for (const e of gs.enemies) {
    if (!e || (e.type === 'engineer' && e.tunneling)) continue;
    if (!Number.isInteger(e.cx) || !Number.isInteger(e.cy)) continue;

    const k = key(e.cx, e.cy);
    if (!hitSet.has(k)) continue; // not in the breath corridor up to nearest

    const idx = indexByKey.get(k);
    const isHero = (e.type === 'hero');

    // if a hero is closer than this enemy, the hero blocks direct damage past itself
    const behindHero = isFinite(heroBlockIdx) && idx > heroBlockIdx;

    // Direct damage rules:
    // - Heroes never take direct (but can take burn).
    // - Units behind the hero (idx>heroBlockIdx) take no direct (blocked).
    const canDirect = !isHero && !behindHero;

    if (canDirect) {
      e.hp -= ds.breathPower;
      markHit(e, ds.breathPower);
    }
    // Burn applies to heroes AND non-behind units (optional: keep burn even if behind hero? we won’t)
    const canBurn = isHero || !behindHero;
    if (canBurn && ds.burnDPS > 0 && ds.burnDuration > 0) {
      e.burnDps = ds.burnDPS;
      e.burnLeft = Math.max(e.burnLeft || 0, ds.burnDuration);
      if (!canDirect) markHit(e, 0.0001);
    }
  }

  // Put breath on cooldown now (one-shot)
  fireCooldown = firePeriod;
}


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
// === Pure queue builder (shared by live waves & preview) ===
function buildWaveQueueFromWave(waveNum, { preview = false } = {}) {
  const wave = Math.max(1, waveNum | 0);
  const n = Math.max(1, waveCountFor(wave));
  const q = [];

  // Specials cadence (match your current rules)
  if (wave % FLAGS.bossEvery === 0)       q.push('boss');
  if (wave % FLAGS.kingsguardEvery === 0) q.push('kingsguard');
  if (wave >= 10 && wave % 4 === 0)        q.push('hero');
  if (wave >= 20 && wave % 3 === 0)        q.push('engineer');

  // Core troops fill
  const remaining = Math.max(0, n - q.length);
  for (let i = 0; i < remaining; i++) {
    if (wave < 4) {
      q.push('villager');
    } else if (wave < 8) {
      q.push((i % 3 === 0) ? 'squire' : 'villager');
    } else {
      q.push((i % 2 === 0) ? 'knight' : 'squire');
    }
  }

  // Keep preview deterministic; live gets a small shuffle
  if (!preview && q.length > 1) {
    for (let i = 1; i < q.length; i++) {
      const j = 1 + ((Math.random() * (q.length - 1)) | 0);
      [q[i], q[j]] = [q[j], q[i]];
    }
  }
  return q;
}

function buildWaveQueue(gs = state.GameState) {
  const wave = (gs.wave | 0) || 1;
  return buildWaveQueueFromWave(wave, { preview: false });
}

export function startWave(gs = state.GameState) {
  _warnedTypesThisWave = new Set();
  // prevent re-entrancy while a wave is active or still spawning
  if (R.waveActive || R.spawning || (R.queue && R.queue.length > 0)) return false;

  // ensure containers
  gs.enemies = gs.enemies || [];
  gs.effects = gs.effects || [];

 // build queue (legacy) OR initialize JSON plan
const cfgWaves = state.getCfg?.(gs)?.waves;
const waveIdx0 = Math.max(0, ((gs.wave | 0) - 1));
_jsonPlan = null;

if (Array.isArray(cfgWaves) && cfgWaves.length && cfgWaves[waveIdx0] && Array.isArray(cfgWaves[waveIdx0].groups)) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

function clampInt(v, lo, hi) {
  v = (v|0);
  if (!Number.isFinite(v)) v = lo;
  return Math.max(lo, Math.min(hi, v));
}
function clampMs(v, lo, hi) {
  v = (v|0);
  if (!Number.isFinite(v)) v = lo;
  return Math.max(lo, Math.min(hi, v));
}

// sensible bounds to avoid microbursts and huge delays
const MIN_INTERVAL_MS = 16;     // ~1 frame
const MAX_INTERVAL_MS = 60000;  // 60s
const MIN_DELAY_MS    = 0;
const MAX_DELAY_MS    = 120000; // 2m
const MIN_COUNT       = 1;
const MAX_COUNT       = 1000;

_jsonPlan = {
  startedAt: now,
  groups: cfgWaves[waveIdx0].groups.map(g => ({
    type: String(g.type || 'villager'),
    remaining: clampInt(g.count ?? 0, MIN_COUNT, MAX_COUNT),
    interval: clampMs((g.interval_ms ?? 0), MIN_INTERVAL_MS, MAX_INTERVAL_MS),
    nextAt: now + clampMs((g.delay_ms ?? 0), MIN_DELAY_MS, MAX_DELAY_MS),
    groupId: 0
  }))
};

  // Keep wave-complete gate from firing early: use a sentinel in R.queue
  R.queue = ['__json__'];
} else {
  R.queue = buildWaveQueue(gs); // legacy path
}

R.spawning = true;
R.waveActive = true;
R.spawnTimer = 0; // spawn immediately on next update tick
R.groupId = 0;
R.groupRemaining = 0;
R.groupLeaderId = null;

return true;

}

export function previewWaveList(arg) {
  const wave =
    (typeof arg === 'number') ? (arg | 0) :
    (arg && typeof arg.wave === 'number') ? (arg.wave | 0) :
    ((state.GameState.wave | 0) || 1);
  return buildWaveQueueFromWave(wave, { preview: true }).slice();
}

export function previewWaveCounts(arg) {
  const list = previewWaveList(arg);
  const counts = Object.create(null);
  for (const t of list) counts[t] = (counts[t] | 0) + 1;
  return counts;
}

// Optional aliases if you ever referenced other names
export const getWavePreview = previewWaveList;
export const nextWavePlan   = previewWaveList;

// Back-compat export if main.js ever uses spawnWave
export const spawnWave = startWave;

/* =========================
 * Update loop
 * ========================= */

 export function update(gs = state.GameState, dt) {
  const enemies = gs.enemies || (gs.enemies = []);
  gs.effects = gs.effects || []; // bombs

  // ---- Success-trail global decay (apply at 5 Hz to reduce work) ----
const T = gs.successTrail;
if (T) {
  trailDecayAccum += dt;
  const step = 0.2; // seconds
  if (trailDecayAccum >= step) {
    const steps = Math.floor(trailDecayAccum / step);
    trailDecayAccum -= steps * step;

    const decayPerSec = 0.6;
    const mul = Math.pow(Math.max(0, 1 - decayPerSec * step), steps);

    for (let y = 0; y < T.length; y++) {
      const row = T[y];
      for (let x = 0; x < row.length; x++) {
        const v = row[x] * mul;
        row[x] = (v < 1e-4) ? 0 : v;
      }
    }
  }
}

// --- Phase 5: JSON-configured spawning (runs when _jsonPlan is active) ---
if (R.spawning && _jsonPlan && Array.isArray(_jsonPlan.groups)) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  for (const G of _jsonPlan.groups) {
    if (G.remaining <= 0) continue;
    if (now >= G.nextAt) {
      // Start new group id when we spawn the first member of this group's burst
      if (!G.groupId) {
        R.groupId++;
        G.groupId = R.groupId;
        R.groupLeaderId = null; // first member will become leader

        const hasCfg = !!(state.getCfg?.(gs)?.enemies?.[type]);
if (!hasCfg && !_warnedTypesThisWave.has(type)) {
  console.warn('[waves.json] Unknown enemy type in wave', (gs.wave|0), '→', type, '— using legacy defaults');
  _warnedTypesThisWave.add(type);
}

      }

      const type = G.type;
      const e = spawnOneIntoGroup(state.GameState, type, G.groupId, R.groupLeaderId);
      if (R.groupLeaderId == null) {
        R.groupLeaderId = e.id;
        e.leader = true;
        e.torchBearer = true;
        e.behavior.sense = (e.behavior.sense || 0.5) * 1.15;
        e.trailStrength = Math.max(e.trailStrength || 0.5, 1.5);
      }
      e.followLeaderId = R.groupLeaderId;

      G.remaining -= 1;
      G.nextAt = (G.interval > 0) ? (now + G.interval) : (now + 1e9); // no interval => effectively "only once"
    }
  }

  // When all JSON groups are depleted, drop the sentinel R.queue so wave-complete can trigger.
  const anyLeft = _jsonPlan.groups.some(g => g.remaining > 0);
  if (!anyLeft) {
    _jsonPlan = null;
    R.queue = []; // release sentinel
  }
}

  // 1) Spawning (group-based)
if (R.spawning && R.queue.length > 0) {
  R.spawnTimer -= dt;

  if (R.groupRemaining <= 0) {
    // Start a new group when timer expires
    if (R.spawnTimer <= 0) {
      R.groupId++;
      R.groupRemaining = Math.min(nextGroupSize(), R.queue.length);
      R.groupLeaderId = null;                 // will be set by first member
      R.spawnTimer = 0;                       // spawn leader immediately
    } else {
      // waiting for groupGap; do nothing
      return;
    }
  }

  if (R.spawnTimer <= 0 && R.groupRemaining > 0) {
    // Pop the next type for this group
    const type = R.queue.shift();
    const e = spawnOneIntoGroup(state.GameState, type, R.groupId, R.groupLeaderId);

    // First member becomes leader if none yet. Also force torch for hero/kingsguard/boss.
    if (R.groupLeaderId == null) {
      R.groupLeaderId = e.id;
      e.leader = true;
      e.torchBearer = true;
      e.behavior.sense = (e.behavior.sense || 0.5) * 1.15;
      e.trailStrength = Math.max(e.trailStrength || 0.5, 1.5);
    }

    // Followers bias toward this group’s leader
    e.followLeaderId = R.groupLeaderId;

    R.groupRemaining--;

    // Schedule next member or next group
    if (R.groupRemaining > 0) {
      R.spawnTimer = FLAGS.spawnGap;       // within-group spacing
    } else {
      R.spawnTimer = FLAGS.groupGap;       // between-group spacing
    }
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
    // If enemy is within range (manhattan) of nearest dragon cell, attack.
   // --- attack-over-time logic (no per-attack round timer; pure DPS) ---
if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
  const nearest = nearestDragonCell(gs, e.cx, e.cy);
  if (nearest) {
    const distMan = Math.abs(nearest.x - e.cx) + Math.abs(nearest.y - e.cy);
    const range = (typeof e.range === 'number') ? e.range : 1;

    if (distMan <= range) {
      // In range: pause movement and apply continuous DPS
      e.pausedForAttack = true;
      e.isAttacking = true;

      const rate = Math.max(0, e.rate || 0);             // attacks/sec
      const perHit = (typeof e.damage === 'number')
        ? e.damage
        :                        
      const dps = rate * perHit;

      // deal damage continuously (no ticking/round timer)
      if (dps > 0 && gs.dragonHP > 0) {
        gs.dragonHP = Math.max(0, gs.dragonHP - dps * dt);
        // touch the healthbar visibility briefly
        markHit(e, 0.0001);
      }

    } else {
      // Out of range: resume movement
      e.pausedForAttack = false;
      e.isAttacking = false;
    }
  }
}

    // Death -> rewards (DoT, projectiles, or other effects may have killed them)
    if (e.hp <= 0) {
  const eg = (typeof e.gold  === 'number') ? (e.gold  | 0) : 5;
  const eb = (typeof e.bones === 'number') ? (e.bones | 0) : 1;
  gs.gold  = (gs.gold  | 0) + eg;
  gs.bones = (gs.bones | 0) + eb;
  enemies.splice(i, 1);
  continue;
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
