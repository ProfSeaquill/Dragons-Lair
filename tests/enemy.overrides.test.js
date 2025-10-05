// tests/enemy.overrides.test.js
import { after, test } from 'node:test';
import assert from 'node:assert';
import * as state from '../state.js';
import * as combat from '../combat.js';

after(() => {
  delete state.__testHooks.inBounds;
});

// Minimal grid/entry/exit for spawning
state.ENTRY.x = 0; state.ENTRY.y = 0;
state.EXIT.x = 5; state.EXIT.y = 0;
state.GRID.tile = 32; state.GRID.rows = 10; state.GRID.cols = 10;
state.__testHooks.inBounds = (x,y) => (x>=0 && y>=0 && x<state.GRID.cols && y<state.GRID.rows);
state.dragonCells = () => [{ x: state.EXIT.x, y: state.EXIT.y }];

test('enemies.json overrides apply to spawned enemy', async () => {
  state.GameState.enemies = [];
  state.GameState.wave = 7;
  state.GameState.cfg = {
    enemies: {
      knight: {
        hp: 123, speed: 1.75, armor: 4, shielded: true,
        attackRate: 0.9, attackDamage: 17, attackRange: 2,
        gold: 9, bones: 2
      }
    }
  };

  combat.devSpawnEnemy(state.GameState, 'knight', 1);
  const e = state.GameState.enemies[0];
  assert.ok(e, 'enemy spawned');

  assert.equal(e.hp, 123);
  assert.equal(e.maxHp, 123);
  assert.equal(e.speed, 1.75);
  assert.equal(e.armor, 4);
  assert.equal(!!e.shield, true);
  assert.equal(e.rate, 0.9);
  assert.equal(e.damage, 17);
  assert.equal(e.range, 2);
  assert.equal(e.gold, 9);
  assert.equal(e.bones, 2);
});
