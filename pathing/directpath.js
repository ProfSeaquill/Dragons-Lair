// pathing/directpath.js
// Grid-optimized A* + "clip at first junction" helper (engine-agnostic)
//
// ──────────────────────────────────────────────────────────────────────────────
// TUNABLE OVERVIEW
// - Heuristic:         manhattan() by default (best for 4-connected grids).
//                      You can scale it with HEURISTIC_WEIGHT for greediness.
// - Costs:             Every step costs 1 on a flat grid; add terrain costs
//                      in costOf() if you later need slow tiles, etc.
// - Search caps:       MAX_NODES and MAX_MICROS guard worst-case mazes on mobile.
// - Tie-breakers:      When f-scores tie, we prefer lower h (closer to goal);
//                      you can also prefer straight/“east” in tieBreak().
// - Clip behavior:     clipAtFirstJunction() stops ON the first junction tile
//                      after leaving start, so your FSM can run a Decision there.
// ──────────────────────────────────────────────────────────────────────────────

import {
  neighbors4,
  dirFromTo,
  isJunction,
  inBounds,
  isPassable,
} from "../grid/walls.js";

//// TUNABLES ///////////////////////////////////////////////////////////////////

// Heuristic scale: >1.0 make
