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
  engineerBombTimer: 10,     // seconds until detonation
  engineerTravelTime: 2.0,   // seconds "digging" underground before popping up
  engineerBombDmg: 35,       // damage to the dragon on bomb detonation
  spawnGap: 0.55,            // seconds between spawns
};

function waveCountFor(wave) {
  const base = 7;          // wave 1 size
  const cap  = 50;         // hard-ish ceiling you wanted (~50)
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
    villager:   { range: 1, rate: 0.45, dmg: Math.max(1, Math.round(tDmg * 0.8)) },
    squire:     { range: 1, rate: 0.65, dmg: Math.round(tDmg * 0.95) },
    knight:     { range: 1, rate: 0.9,  dmg: Math.round(tDmg * 1.0) },
    hero:       { range: 1, rate: 0.8,  dmg: Math.round(tDmg * 1.2) },
    engineer:   { range: 1, rate: 0.5,  dmg: Math.round(tDmg * 0.9) }, // engineers still plant bombs
    kingsguard: { range: 1, rate: 1.0,  dmg: Math.round(tDmg * 1.25) },
    boss:       { range: 1, rate: 0.7,  dmg: Math.round(tDmg * 1.6)  },
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
