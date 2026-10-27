// -----------------------------------------------------------------------------
// The states of the device (src/devices.js): an index is never sent at 0.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexState, liveStates } from '../src/devices.js';

const external = { feature: (key) => `ext:x:alfa:main:${key}` };

test('an index: never 0 nor below nor not a number; 3 decimals', () => {
  for (const bad of [0, -1, NaN, undefined, null, '5']) {
    assert.deepEqual(indexState(external, 'import_index', bad), [], String(bad));
  }
  assert.deepEqual(indexState(external, 'import_index', 1.23456), [
    { device_feature_external_id: 'ext:x:alfa:main:import_index', state: 1.235 },
  ]);
});

test('live states: only the values present; the cut-off seconds only during a warning', () => {
  const states = liveStates(external, {
    importPower: 0,
    band: undefined,
    cutoff: { active: false, left: 30 },
  });
  assert.deepEqual(
    states.map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
    [
      ['import_power', 0],
      ['cutoff_warning', 0],
    ],
  );
});
