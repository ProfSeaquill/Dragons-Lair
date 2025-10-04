// tests/waves.json.spawn.cadence.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import * as state from '../../state.js';
import * as combat from '../../combat.js';

state.ENTRY = { x: 0, y: 0 };
state.EXIT  = { x: 5, y: 0 };
state.GRID  = { tile: 32, rows: 10, cols: 10 };
state.inBounds = (x,y) => (x>=0 && y>=0 && x<state.GRID.cols && y<state.GRID.rows);
state.dragonCells = () => [{ x: state.EXIT.x, y: state.EXIT.y }];

test('JSON wave spawns the right counts per group', async () => {
  // JSON wave for CURRENT wave = 1
  state.GameState.wave = 1;
  state.GameState.enemies = [];
  state.GameState.cfg = {
    enemies: {
      villager: { hp: 10, speed: 1 },
      squire:   { hp: 20, speed: 1 }
    },
    waves: [
      { id: 1, groups: [
        { type: 'villager', count: 3, interval_ms: 100 },
        { type: 'squire',   count: 2, delay_ms: 300, interval_ms: 150 }
      ]}
    ]
  };

  // Monkey-patch performance.now for deterministic timing
  let nowMs = 0;
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => nowMs;

  try {
    combat.startWave(state.GameState);

    // Step time: 1.0s total, tick at 50ms
    for (let i = 0; i < 20; i++) {
      nowMs += 50;
      combat.update(state.GameState, 0.05);
    }

    const counts = state.GameState.enemies.reduce((m,e) => (m[e.type]=(m[e.type]||0)+1, m), {});
    assert.equal(counts.villager || 0, 3);
    assert.equal(counts.squire   || 0, 2);
  } finally {
    // restore
    if (realNow) globalThis.performance.now = realNow;
  }
});
