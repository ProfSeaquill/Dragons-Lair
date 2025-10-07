export const CFG = {
  // Search & Decisions
  DECISION_THINK_TIME: 0.6,       // seconds frozen while “thinking”
  COMMIT_TILES: 3,                // move at least N tiles before next decision
  VISITED_PENALTY: 3,             // score penalty if branch was seen recently
  VISITED_DECAY_SEC: 20,          // how fast “seen recently” fades
  FORWARD_BIAS: 0.5,              // prefer not to U-turn
  DRAGON_SCENT: 1.0,              // heuristic pull toward dragon tile

  // Speed modifiers
  CHARGE_MUL: 1.10,
  FEAR_MUL: 0.80,

  // Perception
  LOS_MAX_TILES: 8,               // line-of-sight radius
  SCENT_RADIUS: 12,               // manhattan radius for heuristic pull

  // Priority (higher beats lower)
  PRI: { search:0, fear:1, decision:2, charge:3 },
};
