//ai/config.js
export const CFG = {
  // Search & Decisions
  DECISION_THINK_TIME: 0.6,       // kept for legacy; junction micro-delay overrides it
  COMMIT_TILES: 3,

  // Junction-only memory (new)
  get JXN_THINK_MS_MIN() {
    return state.getCfg(state.GameState)?.tuning?.ai?.jxnDelayMsMin ?? 100;
  },
  get JXN_THINK_MS_MAX() {
    return state.getCfg(state.GameState)?.tuning?.ai?.jxnDelayMsMax ?? 300;
  },
  COMMIT_BY_TILETYPE: { junction:3, room:3, corridor:0, deadend:0 },

  // Outcome scoring (deadend < loop < room < corridor < dragon)
  OUTCOME_SCORE: { deadend:-2, loop:-1, room:0, corridor:+1, dragon:+3 },

  // Group dynamics
  STRAIGHT_BONUS: 0.20,
  ROOM_EDGE_BIAS: 0.08,
  STRAYS_CAP_FRACTION: 0.15,
  STRAY_TIMEOUT_MS: 6000,

  // Speed modifiers
  CHARGE_MUL: 1.10,
  FEAR_MUL: 0.80,

  // Perception
  LOS_MAX_TILES: 8,

  // Priority (higher beats lower)
  PRI: { search:0, fear:1, decision:2, charge:3, attack:4 },
};
