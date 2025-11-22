// ./combat/upgrades/abilities/vents.js

// Always-on flame vent tiles: data helpers + damage + rendering.
import * as state from '../../../state.js';

function getVentConfig(gs) {
  const cfg = state.getCfg ? state.getCfg(gs) : null;
  const tv = cfg?.tuning?.vents || {};

  const U = gs?.upgrades || {};
  const lvl = Math.max(0, (U.vents | 0));   // vents ability level
  const MAX_LVL = 10;                      // keep in sync with ABILITY_MAX_LEVEL
  const f = Math.max(0, Math.min(1, lvl / MAX_LVL)); // 0..1

  const minCount = (tv.minCount ?? tv.maxCount ?? 3);
  const maxCountCfg = (tv.maxCount ?? minCount);

  const minDps = (tv.minDps ?? tv.dps ?? 8);
  const maxDpsCfg = (tv.maxDps ?? minDps);

  // Linear interpolation between min and max based on level
  const maxCount = Math.round(minCount + (maxCountCfg - minCount) * f);
  const dps      = minDps + (maxDpsCfg - minDps) * f;

  return {
    dps,
    maxCount,       // effective cap at this level
    minCount,
    maxCountCfg,
    minDps,
    maxDps: maxDpsCfg,
    lvl,
    f,
  };
}


/**
 * Ensure vent-related fields exist on the game state.
 * (Safe to call as often as you like.)
 */
function ensureVentState(gs) {
  if (!gs) gs = state.GameState;
  if (!Array.isArray(gs.flameVents)) gs.flameVents = [];

  const { maxCount } = getVentConfig(gs);

  // Never allow more vents than the current cap for this level
  if (gs.flameVents.length > maxCount) {
    gs.flameVents.length = maxCount;
  }

  const used = gs.flameVents.length;
  gs.flameVentsAvailable = Math.max(0, maxCount - used);

  return gs;
}


/**
 * Place a vent on tile (x,y) if there is pool available and no vent already.
 * Returns true if a vent exists there after the call.
 */
export function placeFlameVent(gs, x, y) {
  gs = ensureVentState(gs);

  // Already vented? nothing to do
  if (gs.flameVents.some(v => v.x === x && v.y === y)) return true;

  if ((gs.flameVentsAvailable | 0) <= 0) return false;

  gs.flameVents.push({ x, y });
  gs.flameVentsAvailable = (gs.flameVentsAvailable | 0) - 1;
  return true;
}

/**
 * Remove a vent from tile (x,y) if present and return it to the pool.
 * Returns true if something was removed.
 */
export function removeFlameVent(gs, x, y) {
  gs = ensureVentState(gs);
  const arr = gs.flameVents;
  let removed = false;

  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v && v.x === x && v.y === y) {
      arr.splice(i, 1);
      removed = true;
    }
  }

  if (removed) {
    gs.flameVentsAvailable = (gs.flameVentsAvailable | 0) + 1;
  }
  return removed;
}

/**
 * Per-frame damage: any enemy standing on a vent tile takes DPS.
 * Call from main update(dt) *after* movement/combat.
 */
export function applyFlameVents(gs, dt) {
  if (!gs) gs = state.GameState;
  ensureVentState(gs);

  const vents = gs.flameVents;
  if (!Array.isArray(vents) || !vents.length) return;
  if (!Array.isArray(gs.enemies) || !gs.enemies.length) return;
  if (dt <= 0) return;

  const { dps } = getVentConfig(gs);
  const dmg = dps * dt;

  // Build a quick lookup for "hot tiles"
  const hot = new Set();
  for (const v of vents) {
    if (!v) continue;
    hot.add(`${v.x},${v.y}`);
  }
  if (!hot.size) return;

  for (const e of gs.enemies) {
    if (!e || e.dead) continue;

    const cx = (e.cx | 0);
    const cy = (e.cy | 0);
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) continue;

    if (!hot.has(`${cx},${cy}`)) continue;

    e.hp -= dmg;
    if (e.hp <= 0 && !e.dead) {
      e.hp = 0;
      e.dead = true;
      // (If you want gold/bones here, we can mirror your usual dragon-kill path later.)
    }
  }
}

/**
 * Visual: draw a persistent flame patch on each vent tile.
 * Called from render.js → drawFlameVents(ctx, gs).
 */
export function drawFlameVents(ctx, gs = state.GameState) {
  ensureVentState(gs);
  const vents = gs.flameVents;
  if (!Array.isArray(vents) || !vents.length) return;

  const t = state.GRID.tile || 32;
  const time = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() * 0.001
    : Date.now() * 0.001;

  for (const v of vents) {
    if (!v) continue;
    const cx = (v.x + 0.5) * t;
    const cy = (v.y + 0.5) * t;

    const baseR = t * 0.44;
    const pulse = 0.08 * Math.sin(time * 4.0 + (v.x + v.y) * 0.7);
    const r = baseR * (1 + pulse);

    ctx.save();
    ctx.globalAlpha = 0.9;

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0.00, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,215,140,0.85)');
    g.addColorStop(0.75, 'rgba(255,120,40,0.70)');
    g.addColorStop(1.00, 'rgba(255,60,10,0.00)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
