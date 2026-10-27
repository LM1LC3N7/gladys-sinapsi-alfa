// -----------------------------------------------------------------------------
// The registers -> values (src/alfa/model.js), on the register map of the
// reference.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCHES } from '../src/constants.js';
import { parseRegisters } from '../src/alfa/model.js';
import { registers } from './fixtures/alfa.js';

const wordsOf = (map) =>
  BATCHES.map(([start, count]) => Array.from({ length: count }, (_, i) => map.get(start + i) ?? 0));
const parse = (values) => parseRegisters(wordsOf(registers(values)));

test('a home with solar panels: every value, in W and kWh', () => {
  const r = parse({ exportPower: 300, productionPower: 1500 });
  assert.equal(r.warmup, false);
  assert.equal(r.importPower, 850);
  assert.equal(r.importAverage, 800);
  assert.equal(r.importIndex, 1234.567);
  assert.equal(r.exportPower, 300);
  assert.equal(r.exportAverage, 0);
  assert.equal(r.exportIndex, 345.678);
  assert.equal(r.productionPower, 1500);
  assert.equal(r.productionIndex, 400);
  // 850 drawn + (1500 produced - 300 fed) used at home.
  assert.equal(r.consumptionPower, 2050);
  assert.equal(r.band, 2);
  assert.deepEqual(r.cutoff, { active: false, at: undefined, left: undefined });
  assert.equal(r.productionInvalid, false);
});

test('32-bit totals: high word first, beyond 65535 Wh', () => {
  const r = parse({ importWh: 0x12345678 });
  assert.equal(r.importIndex, 0x12345678 / 1000);
});

test('starting: the import total or the band at 0 marks the whole reading', () => {
  assert.equal(parse({ importWh: 0 }).warmup, true);
  assert.equal(parse({ band: 0 }).warmup, true);
  assert.equal(parse({}).warmup, false);
});

test('"not available" is never a measurement: 65535 W, 0xFFFFFFFF Wh', () => {
  const r = parse({ importPower: 0xffff, importWh: 0xffffffff, importAverage: 0xffff });
  assert.equal(r.importPower, undefined);
  assert.equal(r.importAverage, undefined);
  assert.equal(r.importIndex, undefined);
  assert.equal(r.consumptionPower, undefined);
  assert.equal(r.warmup, false);
});

test('a home that never fed the grid: no export values, home power = drawn', () => {
  const r = parse({ exportWh: 0, productionWh: 0, productionPower: 0, exportPower: 0 });
  assert.equal(r.exportPower, undefined);
  assert.equal(r.exportIndex, undefined);
  assert.equal(r.exportAverage, undefined);
  assert.equal(r.productionPower, undefined, 'production 0 is no production data');
  assert.equal(r.productionIndex, undefined);
  assert.equal(r.consumptionPower, 850);
  assert.equal(r.productionInvalid, false);
});

test('production below the energy fed: not valid, no production nor home power', () => {
  const r = parse({ productionWh: 1000, exportWh: 345_678 });
  assert.equal(r.productionIndex, undefined);
  assert.equal(r.productionPower, undefined);
  assert.equal(r.consumptionPower, undefined);
  assert.equal(r.productionInvalid, true);
  assert.equal(r.exportIndex, 345.678);
  const zero = parse({ productionWh: 0 });
  assert.equal(zero.productionInvalid, true);
  assert.equal(zero.consumptionPower, undefined);
});

test('home power never counts more fed than produced', () => {
  assert.equal(
    parse({ exportPower: 2000, productionPower: 1500, importPower: 0 }).consumptionPower,
    0,
  );
});

test('the band: 1 to 6 only; above is unknown, never a number', () => {
  for (const band of [1, 6]) assert.equal(parse({ band }).band, band);
  const r = parse({ band: 7 });
  assert.equal(r.band, undefined);
  assert.equal(r.bandUnknown, true);
});

test('the cut-off warning: a time, the seconds left, the time of the cut-off', () => {
  const t = Date.UTC(2026, 9, 27, 10) / 1000;
  assert.deepEqual(parse({ event: t, left: 120 }).cutoff, { active: true, at: t + 120, left: 120 });
  assert.deepEqual(parse({ event: t, left: 0xffff }).cutoff, {
    active: true,
    at: t,
    left: undefined,
  });
  assert.equal(parse({ event: 0 }).cutoff.active, false);
  assert.equal(parse({ event: 0xffffffff, left: 30 }).cutoff.active, false);
});

test('a batch missing or a word out of range: undefined, never 0', () => {
  const words = wordsOf(registers());
  words[3] = [];
  const r = parseRegisters(words);
  assert.equal(r.productionIndex, undefined);
  assert.equal(r.productionPower, undefined);
  const odd = wordsOf(registers());
  odd[0][0] = -1;
  assert.equal(parseRegisters(odd).importPower, undefined);
});
