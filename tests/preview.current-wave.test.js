// tests/preview.current-wave.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import * as state from '../state.js';
import * as combat from '../combat.js';

test('preview uses CURRENT wave in JSON mode', async () => {
  // Arrange: set GameState + cfg
  state.GameState.wave = 2;
  state.GameState.cfg = {
    waves: [
      { id: 1, groups: [{ type: 'villager', count: 2 }] },
      { id: 2, groups: [{ type: 'squire', count: 3 }] }
    ]
  };

  const list = combat.previewWaveList(); // no arg => use GameState.wave
  assert.deepStrictEqual(list.sort(), ['squire','squire','squire'].sort());
});

test('preview falls back when JSON waves missing', async () => {
  state.GameState.wave = 1;
  state.GameState.cfg = { waves: [] }; // simulate missing
  const list = combat.previewWaveList();
  assert.ok(Array.isArray(list) && list.length > 0, 'fallback preview should be non-empty');
});
