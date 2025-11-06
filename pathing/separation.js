// pathing/separation.js
// Sub-tile visual separation for stacked units — no occupancy dependency.
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - maxOffsetRatio (0..0.5): Max ring radius as a fraction of tileSize.
// - minOffsetRatio (0..0.5): Minimum ring radius for tiny stacks.
// - idSpinStrength (0..1):   Per-id spin amount (0 disables).
//
// HOW TO USE (no occupancy):
// 1) Each render frame, build rosters:
//      const rosters = buildTileRosters(units); // Map<"x,y", id[]>
// 2) For each unit when drawing:
//      const [ox, oy] = renderOffsetNoOcc(unit, rosters, TILE, { maxOffsetRatio: 0.2 });
//    Draw at (unit.x*TILE + TILE/2 + ox, unit.y*TILE + TILE/2 + oy).
//
// Notes:
// - Purely visual. No pathing/logic changes.
// - Keep maxOffsetRatio <= 0.25 to avoid bleeding into neighboring tiles.
// - Stable agent.id yields stable spins.
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SEP_OPTS = {
  maxOffsetRatio: 0.25, // TUNABLE: cap ring radius (0..0.5)
  minOffsetRatio: 0.10, // TUNABLE: floor for tiny groups
  idSpinStrength: 1.0,  // TUNABLE: 0 disables per-id spin
};

const TAU = Math.PI * 2;

/** Linear interpolation between a and b with t in [0,1]. */
function lerp(a, b, t) { return a + (b - a) * t; }
/** Clamp v to [0,1]. */
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/**
 * Hash an id (number or string) into [0,1). Deterministic and fast.
 * @param {number|string} id
 */
function idToUnit(id) {
  let h;
  if (typeof id === 'number') {
    h = id | 0;
  } else {
    const s = String(id);
    h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Compute a deterministic sub-tile offset for a unit.
 * @param {number} count             // agents on this tile (>=1)
 * @param {number} indexWithinTile   // 0-based index of this agent in the tile roster
 * @param {number} tileSize          // pixels per tile
 * @param {Partial<typeof DEFAULT_SEP_OPTS>} [optsIn]
 * @param {number|string} [stableId] // optional: id used to add a stable spin
 * @returns {[number, number]}       // [ox, oy] in pixels
 */
export function computeOffset(count, indexWithinTile, tileSize, optsIn, stableId) {
  const opts = { ...DEFAULT_SEP_OPTS, ...optsIn };
  if (count <= 1 || indexWithinTile < 0) return [0, 0];

  const base = clamp01(opts.minOffsetRatio);
  const maxr = clamp01(opts.maxOffsetRatio);
  const t = clamp01((count - 2) / 6);               // gentle growth up to ~8 units
  const radius = lerp(base, maxr, t) * tileSize;

  const spin = (opts.idSpinStrength ?? 1.0) * (stableId != null ? idToUnit(stableId) : 0);
  const angle = (indexWithinTile / count + spin) * TAU;

  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;
  return [ox, oy];
}

/**
 * Build per-frame tile rosters from your live units.
 * Each unit must have integer { id, x, y }.
 * @param {Array<{id:any, x:number, y:number}>} units
 * @returns {Map<string, any[]>} // key "x,y" -> array of ids (stable push order)
 */
export function buildTileRosters(units) {
  const m = new Map();
  for (const u of units) {
    const k = `${u.x|0},${u.y|0}`;
    const list = m.get(k);
    if (list) list.push(u.id);
    else m.set(k, [u.id]);
  }
  return m;
}

/**
 * Convenience: compute offset for a unit using a prebuilt roster map.
 * @param {{id:any, x:number, y:number}} unit
 * @param {Map<string, any[]>} rosters   // from buildTileRosters()
 * @param {number} tileSize
 * @param {Partial<typeof DEFAULT_SEP_OPTS>} [opts]
 * @returns {[number, number]}
 */
export function renderOffsetNoOcc(unit, rosters, tileSize, opts) {
  const k = `${unit.x|0},${unit.y|0}`;
  const list = rosters.get(k);
  if (!list || list.length <= 1) return [0, 0];
  const idx = list.indexOf(unit.id);
  if (idx < 0) return [0, 0];
  return computeOffset(list.length, idx, tileSize, opts, unit.id);
}

/**
 * Optional helper: get (count, index) without building a Map—useful if you
 * already have per-tile arrays from your renderer.
 * @param {any[]} idsAtTile
 * @param {any}   id
 * @param {number} tileSize
 * @param {Partial<typeof DEFAULT_SEP_OPTS>} [opts]
 */
export function renderOffsetFromList(idsAtTile, id, tileSize, opts) {
  if (!idsAtTile || idsAtTile.length <= 1) return [0, 0];
  const idx = idsAtTile.indexOf(id);
  if (idx < 0) return [0, 0];
  return computeOffset(idsAtTile.length, idx, tileSize, opts, id);
}
