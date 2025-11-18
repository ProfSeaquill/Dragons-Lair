// pathing/occupancy.js
// Soft-occupancy tracking for a 4-way grid.
// - Counts how many agents are on each tile
// - Exposes "soft block" signals (discourage but don't forbid crowded tiles)
// - Keeps a per-tile roster so you can render stable sub-tile offsets
//
// Public API (functional and instance-style):
//   makeOccupancy(cols, rows) -> occ
//   enter(occ, x, y, id)      // increments count, records id in tile roster
//   leave(occ, x, y, id)      // decrements count, removes id from tile roster
//   count(occ, x, y) -> number
//   isSoftBlocked(occ, x, y, cap=3) -> boolean
//   neighborsOverCap(occ, x, y, cap=3) -> Array<[nx,ny]>
//   getIndexWithinTile(occ, x, y, id) -> number   // 0-based, stable within a tile
//
// Instance-style convenience (same behavior):
//   occ.enter(id,x,y)
//   occ.leave(id,x,y)
//   occ.count(x,y)
//   occ.isSoftBlocked(occ,x,y,cap)    // kept to match your navigator's current callsite
//   occ._isSoftBlocked(x,y,cap)       // cleaner bound version
//   occ.neighborsOverCap(x,y,cap)
//   occ.getIndexWithinTile(x,y,id)

const DIR4 = [
  [ 1, 0],  // E
  [-1, 0],  // W
  [ 0, 1],  // S
  [ 0,-1],  // N
];

export function makeOccupancy(cols, rows) {
  const size = cols * rows;
  const counts = new Uint16Array(size);     // per-tile population
  const roster = new Map();                 // key "x,y" -> Array<id> (stable order)

  const idx = (x, y) => y * cols + x;
  const key = (x, y) => `${x},${y}`;

  const inBounds = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;

  /** @param {number} x @param {number} y @param {any} id */
  function _enter(x, y, id) {
    if (!inBounds(x, y)) return;
    counts[idx(x, y)]++;
    const k = key(x, y);
    const list = roster.get(k);
    if (list) {
      // Keep a stable order; avoid duplicates if user double-calls
      if (!list.includes(id)) list.push(id);
    } else {
      roster.set(k, [id]);
    }
  }

  /** @param {number} x @param {number} y @param {any} id */
  function _leave(x, y, id) {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (counts[i] > 0) counts[i]--;
    const k = key(x, y);
    const list = roster.get(k);
    if (list) {
      const pos = list.indexOf(id);
      if (pos !== -1) list.splice(pos, 1);
      if (list.length === 0) roster.delete(k);
    }
  }

  /** @param {number} x @param {number} y */
  function _count(x, y) {
    if (!inBounds(x, y)) return 0;
    return counts[idx(x, y)];
  }

  /** @param {number} x @param {number} y @param {number} [cap=3] */
  function _isSoftBlocked(x, y, cap = 3) {
    return _count(x, y) >= cap;
  }

  /** @param {number} x @param {number} y @param {number} [cap=3] */
  function _neighborsOverCap(x, y, cap = 3) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const nx = x + DIR4[i][0];
      const ny = y + DIR4[i][1];
      if (inBounds(nx, ny) && _count(nx, ny) >= cap) out.push([nx, ny]);
    }
    return out;
  }

  /** Stable index of id within the tile’s roster (0-based). Returns -1 if not present. */
  function _getIndexWithinTile(x, y, id) {
    const list = roster.get(key(x, y));
    if (!list) return -1;
    return list.indexOf(id);
  }

  // Instance object
  const occ = {
    cols, rows, counts, roster, idx, inBounds,

    // Instance-style
    enter: (id, x, y) => _enter(x, y, id),
    leave: (id, x, y) => _leave(x, y, id),
    count: (x, y) => _count(x, y),
    // Keep this odd signature to match your current navigator usage:
    isSoftBlocked: (self, x, y, cap = 3) => _isSoftBlocked(x, y, cap),
    _isSoftBlocked: (x, y, cap = 3) => _isSoftBlocked(x, y, cap),
    neighborsOverCap: (x, y, cap = 3) => _neighborsOverCap(x, y, cap),
    getIndexWithinTile: (x, y, id) => _getIndexWithinTile(x, y, id),
  };

  return occ;
}

// ---- Functional exports (if you prefer free functions) ----

/** @param {ReturnType<typeof makeOccupancy>} occ */
export function enter(occ, x, y, id) { occ.enter(id, x, y); }
/** @param {ReturnType<typeof makeOccupancy>} occ */
export function leave(occ, x, y, id) { occ.leave(id, x, y); }
/** @param {ReturnType<typeof makeOccupancy>} occ */
export function count(occ, x, y) { return occ.count(x, y); }
/** @param {ReturnType<typeof makeOccupancy>} occ */
export function isSoftBlocked(occ, x, y, cap = 3) { return occ._isSoftBlocked(x, y, cap); }
/** @param {ReturnType<typeof makeOccupancy>} occ */
export function neighborsOverCap(occ, x, y, cap = 3) { return occ.neighborsOverCap(x, y, cap); }
/** @param {ReturnType<typeof makeOccupancy>} occ */
export function getIndexWithinTile(occ, x, y, id) { return occ.getIndexWithinTile(x, y, id); }
