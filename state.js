// state.js
export const GRID = { cols: 24, rows: 16, tile: 32 }; // 768x512

export const COSTS = {
  wall: 50,
  wallRefund: 25,
};

export const DragonBase = {
  maxHP: 100,
  power: 5,          // base damage per tick
  reach: 5,          // tiles
  speed: 1.0,        // breaths per second
  burn: 1,           // burn damage per second
  burnDuration: 3,   // seconds
};

export const UpgradeSteps = {
  power: [5, 8, 12, 18, 26, 38, 55],
  reach: [5, 6, 7, 8, 9, 10, 12],
  speed: [1.0, 1.25, 1.6, 2.0, 2.5, 3.0],
  burn:  [1, 2, 3, 5, 8, 12],
};

export const GameState = {
  tick: 0,
  running: false,
  wave: 1,
  gold: 0,
  bones: 0,
  dragon: {
    hp: DragonBase.maxHP,
    powerLvl: 0,
    reachLvl: 0,
    speedLvl: 0,
    burnLvl: 0,
  },
  grid: null,       // 0 empty, 1 wall
  path: [],         // A* result [{c,r}, ...]
  enemies: [],      // active enemies
  projectiles: [],
  lastBreath: 0,
  autoStart: false,
};

export function getDragonStats() {
  return {
    hp: GameState.dragon.hp,
    power: UpgradeSteps.power[GameState.dragon.powerLvl] ?? DragonBase.power,
    reach: UpgradeSteps.reach[GameState.dragon.reachLvl] ?? DragonBase.reach,
    speed: UpgradeSteps.speed[GameState.dragon.speedLvl] ?? DragonBase.speed,
    burn:  UpgradeSteps.burn[GameState.dragon.burnLvl] ?? DragonBase.burn,
    burnDuration: DragonBase.burnDuration,
  };
}

export function resetGrid() {
  const g = [];
  for (let r = 0; r < GRID.rows; r++) {
    g.push(new Array(GRID.cols).fill(0));
  }
  GameState.grid = g;
}

// Persistent save/load
export function saveState() {
  const data = { GameState };
  localStorage.setItem('dragons_lair_save', JSON.stringify(data));
}

export function loadState() {
  const raw = localStorage.getItem('dragons_lair_save');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    Object.assign(GameState, data.GameState);
    return true;
  } catch (e) {
    console.error('Load failed', e);
    return false;
  }
}

// Fixed entry/exit tiles (left entry -> right exit)
export const ENTRY = { c: 0,              r: Math.floor(GRID.rows / 2) };
export const EXIT  = { c: GRID.cols - 1,  r: Math.floor(GRID.rows / 2) };
