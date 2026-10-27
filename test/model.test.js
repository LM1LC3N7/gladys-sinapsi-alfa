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
  assert.equal(r.noProductionData, false);
  assert.equal(r.productionBelowExport, false);
  assert.deepEqual(r.unread, []);
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
  assert.equal(r.noProductionData, false);
});

test('production below the energy fed: still published (as the reference), told', () => {
  // A production meter replaced after years of export: its total starts again.
  const r = parse({ productionWh: 100_000, exportWh: 200_000, productionPower: 900 });
  assert.equal(r.productionIndex, 100);
  assert.equal(r.productionPower, 900);
  assert.equal(r.consumptionPower, 850 + 900);
  assert.equal(r.productionBelowExport, true);
  assert.equal(r.noProductionData, false);
  assert.equal(r.exportIndex, 200);
});

test('no production total while the home fed the grid: no production data, no home power', () => {
  const zero = parse({ productionWh: 0 });
  assert.equal(zero.noProductionData, true);
  assert.equal(zero.productionIndex, undefined);
  assert.equal(zero.productionPower, undefined);
  assert.equal(zero.consumptionPower, undefined);
});

test('production batch not read: never "no production data" (the cause is the batch)', () => {
  const words = wordsOf(registers());
  words[3] = undefined;
  const r = parseRegisters(words);
  assert.equal(r.noProductionData, false);
  assert.deepEqual(r.unread, [921]);
  assert.equal(r.productionIndex, undefined);
  assert.equal(r.consumptionPower, undefined);
});

test('band not read: start-up told by the import total alone, flagged', () => {
  const words = wordsOf(registers());
  words[1] = undefined;
  const r = parseRegisters(words);
  assert.equal(r.warmup, false);
  assert.equal(r.bandUnread, true);
  const cold = wordsOf(registers({ importWh: 0 }));
  cold[1] = undefined;
  assert.equal(parseRegisters(cold).warmup, true);
});

test('a total whose high word is 0xFFFF is a sentinel, never a first value', () => {
  for (const wh of [0xffff0000, 0xfffffffe, 0xffffffff]) {
    const r = parse({ importWh: wh, exportWh: wh, productionWh: wh });
    assert.equal(r.importIndex, undefined, wh.toString(16));
    assert.equal(r.exportIndex, undefined);
    assert.equal(r.productionIndex, undefined);
  }
  assert.equal(parse({ importWh: 0xfffeffff }).importIndex, 0xfffeffff / 1000);
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
  // 0xFFFFFFFE is "none" on some meters (node-red-contrib-alfasinapsi-ultimate 1.1.6).
  assert.equal(parse({ event: 0xfffffffe, left: 30 }).cutoff.active, false);
  assert.equal(parse({ event: 0xffff1234, left: 30 }).cutoff.active, false);
  assert.equal(parse({ event: 0xfffeffff, left: 30 }).cutoff.active, true);
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
