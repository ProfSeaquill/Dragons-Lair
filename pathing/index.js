// pathing/separation.js
// Sub-tile visual separation for stacked units.
//
// Goal: when multiple agents occupy the same tile, render them with small,
// deterministic offsets so they remain visible without affecting logic.
//
// Design:
// - If there's only 1 agent on a tile => offset [0,0] (dead center).
// - If 2+ agents => place them on a small ring around the center.
// - The ring angle has a tiny id-based spin so different tiles / rosters don't
//   all align the same way.
// - Offsets are in *pixels*, based on the provided tileSize.
//
// Public API:
//   DEFAULT_SEP_OPTS
//   computeOffset(count, indexWithinTile, tileSize, opts?) -> [ox, oy]
//   renderOffset(agent, occ, tileSize, opts?) -> [ox, oy]
//     - Uses occ.count(x,y) and occ.getIndexWithinTile(x,y,id)
//     - Returns [0,0] if the agent is not registered in that tile
//
// Notes:
// - This is purely visual. It does not change positions or pathing.
// - For typical soft caps (~3), a single ring is sufficient. If you later
//   want multi-ring packing for very large stacks, we can extend this easily.

export const DEFAULT_SEP_OPTS = {
  // Max offset radius as a fraction of tileSize (0.0 .. 0.5 is sensible).
  // 0.25 == 25% of a tile; looks good while avoiding overlap with neighbors.
  maxOffsetRatio: 0.25,

  // Minimum radius for small groups so they don't sit on top of the center.
  // This is multiplied by tileSize as well.
  minOffsetRatio: 0.10,

  // How much to spin the ring based on agent id (0..1). 0 disables; 1 uses full spin.
  idSpinStrength: 1.0,
};

/**
 * Compute a deterministic, sub-tile offset for an agent given its order
 * within the tile's roster.
 *
 * @param {number} count             // agents on this tile (>=1)
 * @param {number} indexWithinTile   // 0-based index of this agent in the tile roster
 * @param {number} tileSize          // pixels per tile (e.g., GRID.tile)
 * @param {Partial<typeof DEFAULT_SEP_OPTS>} [optsIn]
 * @param {number|string} [stableId] // optional: id used to add a stable spin
 * @returns {[number, number]}       // [ox, oy] in pixels
 */
export function computeOffset(count, indexWithinTile, tileSize, optsIn, stableId) {
  const opts = { ...DEFAULT_SEP_OPTS, ...optsIn };
  if (count <= 1 || indexWithinTile < 0) return [0, 0];

  // Radius grows a touch with crowd size, but caps at maxOffsetRatio
  const base = clamp01(opts.minOffsetRatio);
  const maxr = clamp01(opts.maxOffsetRatio);
  const t = clamp01((count - 2) / 6); // gentle growth up to ~8 units
  const radius = lerp(base, maxr, t) * tileSize;

  // Evenly space on a circle, with a stable, id-based spin to break symmetry.
  const spin = (opts.idSpinStrength ?? 1.0) * (stableId != null ? idToUnit(stableId) : 0);
  const angle = (indexWithinTile / count + spin) * TAU;

  const ox = Math.cos(angle) * radius;
  const oy = Math.sin(angle) * radius;
  return [ox, oy];
}

/**
 * Convenience: compute the offset for an agent using the occupancy object.
 * Expects the occupancy to implement:
 *   - occ.count(x,y) -> number
 *   - occ.getIndexWithinTile(x,y,id) -> number (0-based) or -1 if missing
 *
 * @param {{id:any, x:number, y:number}} agent
 * @param {{count:(x:number,y:number)=>number, getIndexWithinTile:(x:number,y:number,id:any)=>number}} occ
 * @param {number} tileSize
 * @param {Partial<typeof DEFAULT_SEP_OPTS>} [opts]
 * @returns {[number, number]}
 */
export function renderOffset(agent, occ, tileSize, opts) {
  const x = agent.x | 0, y = agent.y | 0;
  const count = occ.count(x, y);
  if (count <= 1) return [0, 0];

  const idx = occ.getIndexWithinTile(x, y, agent.id);
  if (idx < 0) return [0, 0];

  return computeOffset(count, idx, tileSize, opts, agent.id);
}

// pathing/index.js (adapter stubs so state.js can import them)

export function updateAgent(e, gs, dt = 0) {
  // No-op “still alive” result so the game loop doesn’t break.
  // If your engine already moves enemies elsewhere, this won’t interfere.
  if (!e || !gs) return { ok: true };

  // If someone set a flag like e.dead elsewhere:
  if (e.hp != null && e.hp <= 0) return { dead: true };

  // If this enemy is already marked as having reached exit:
  if (e.arrived) return { arrived: true };

  // If you have a path array and want the tiniest motion:
  if (Array.isArray(e.path) && e.path.length) {
    const tsize = gs?.GRID?.tile || 32;
    const idx = e.pathIdx | 0;
    const node = e.path[idx] || e.path[e.path.length - 1];
    const targetX = (node.x + 0.5) * tsize;
    const targetY = (node.y + 0.5) * tsize;

    // Use pixel coords if present; otherwise initialize from cx/cy
    if (typeof e.x !== 'number' || typeof e.y !== 'number') {
      if (Number.isInteger(e.cx) && Number.isInteger(e.cy)) {
        e.x = (e.cx + 0.5) * tsize;
        e.y = (e.cy + 0.5) * tsize;
      }
    }

    if (typeof e.x === 'number' && typeof e.y === 'number') {
      const speed = (e.speed || 1.0) * (tsize * 2.0); // pixels/sec fallback
      const dx = targetX - e.x, dy = targetY - e.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(0, speed * dt);

      if (dist <= Math.max(1, tsize * 0.1)) {
        e.pathIdx = idx + 1;
        if (e.pathIdx >= e.path.length) {
          // Treat end-of-path as arrival at EXIT
          return { arrived: true };
        }
        return { ok: true };
      } else if (step > 0) {
        e.x += (dx / (dist || 1)) * Math.min(step, dist);
        e.y += (dy / (dist || 1)) * Math.min(step, dist);
        return { ok: true };
      }
    }

    // Couldn’t progress, ask caller to replan if grid changed:
    if (gs?.topologyRevision && e._seenTopoRev !== gs.topologyRevision) {
      e._seenTopoRev = gs.topologyRevision;
      return { replan: true };
    }
    return { stalled: true };
  }

  // No path known → request a replan
  return { replan: true };
}

export function despawnAgent(gs, e, reason = 'unknown') {
  if (!gs || !e) return;
  const list = gs.enemies;
  if (Array.isArray(list)) {
    const idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1);
  }
  if (reason === 'arrived') {
    const dmg = (e.damage | 0) || 1;
    gs.dragonHP = Math.max(0, (gs.dragonHP | 0) - dmg);
  }
  // Optional: currency/effects hooks could go here if you want.
}

// ---- Init / topology -------------------------------------------------------

export function initPathing(gs) {
  // Ensure a topology revision counter exists
  gs.topologyRevision = gs.topologyRevision | 0;
  return { ok: true };
}

// Utility you can call when walls change
export function onTopologyChanged(gs) {
  gs.topologyRevision = (gs.topologyRevision | 0) + 1;
  return gs.topologyRevision;
}

// ===== helpers =====

const TAU = Math.PI * 2;

/** Linear interpolation between a and b with t in [0,1]. */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Clamp v to [0,1]. */
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/**
 * Hash an id (number or string) into [0,1).
 * Simple xorshift-ish mix; deterministic and fast.
 * @param {number|string} id
 */
function idToUnit(id) {
  let h;
  if (typeof id === 'number') {
    h = id | 0;
  } else if (typeof id === 'string') {
    h = 2166136261 >>> 0; // FNV-ish start
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  } else {
    // Fallback: use object identity via toString
    const s = String(id);
    h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  // final avalanching
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;

  // Map to [0,1)
  return (h >>> 0) / 4294967296;
}
