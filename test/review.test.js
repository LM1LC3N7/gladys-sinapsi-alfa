// -----------------------------------------------------------------------------
// The points of review r1: a silent secondary batch, the bounds of the
// acceptance, frozen values, the guards in /data before Gladys, a late answer
// of an old session, a crash during a read, a cut-off already past.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FROZEN_AFTER, POLL_INTERVAL, SILENT_SKIP_READS } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { registers } from './fixtures/alfa.js';
import { BATCHES } from '../src/constants.js';
import { F, MINUTE, NOW, SECOND, created, setup } from './helpers/app.js';

const en = (status) => status?.message?.en ?? '';

/** A read whose secondary batch waits for its short timeout. */
async function readWithSilence(t) {
  await t.advance(0);
  await t.advance(3 * SECOND);
  await t.app.idle();
}

test('a silent secondary batch: the rest is published, said, then left out a few reads', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.silentStarts = new Set([780]);
  await t.app.start({ address: '192.168.1.50' });
  await readWithSilence(t);
  assert.deepEqual(t.states('import_power'), [850]);
  assert.deepEqual(t.states('import_index'), [1234.567]);
  assert.deepEqual(t.states('cutoff_warning'), []);
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
  assert.match(
    en(t.gladys.fake.connectionStatus),
    /not read this time: cut-off warning \(not answered, left out for a few reads\), production \(not tried after a silence in this read\)/,
  );
  // The next reads leave 780 out (the production is read again), then try it.
  t.alfa.requests.length = 0;
  for (let i = 0; i < SILENT_SKIP_READS; i += 1) {
    await t.wait(POLL_INTERVAL);
  }
  assert.equal(t.alfa.requests.length, SILENT_SKIP_READS * 3, '780 never asked meanwhile');
  assert.ok(t.states('production_index').length > 0);
  assert.match(en(t.gladys.fake.connectionStatus), /cut-off warning \(left out after a silence/);
  t.alfa.silentStarts = new Set();
  await t.wait(POLL_INTERVAL);
  assert.equal(t.alfa.requests.length, SILENT_SKIP_READS * 3 + 4, 'tried again');
  assert.deepEqual(t.states('cutoff_warning'), [0]);
  assert.doesNotMatch(en(t.gladys.fake.connectionStatus), /not read this time/);
});

test('the grid batch silent: the read fails (it is required)', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.silentStarts = new Set([2]);
  await t.app.start({ address: '192.168.1.50' });
  await t.advance(0);
  await t.advance(6 * SECOND);
  await t.app.idle();
  assert.match(en(t.gladys.fake.connectionStatus), /no answer in time/);
  assert.equal(t.gladys.fake.states.length, 0);
});

/** A device with the import index held back (a drop to 1 kWh). */
async function held() {
  const t = await setup({ devices: [created()] });
  await t.start();
  t.alfa.set({ importWh: 1000 });
  await t.wait(MINUTE);
  assert.match(en(t.gladys.fake.connectionStatus), /Energy drawn index held back/);
  return t;
}

test('accept: the first click alone accepts nothing, even after reads', async () => {
  const t = await held();
  const first = await t.app.acceptHeldIndex();
  assert.match(first.en, /A second click accepts/);
  await t.wait(2 * MINUTE);
  assert.deepEqual([...new Set(t.states('import_index'))], [1234.567]);
  assert.match(en(t.gladys.fake.connectionStatus), /Energy drawn index held back/);
});

test('accept: a second click after 5 minutes is a first click again', async () => {
  const t = await held();
  await t.app.acceptHeldIndex();
  await t.wait(6 * MINUTE);
  const late = await t.app.acceptHeldIndex();
  assert.match(late.en, /A second click accepts/);
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1234.567);
});

test('accept: another session (address changed) between the clicks accepts nothing', async () => {
  const t = await held();
  await t.app.acceptHeldIndex();
  await t.app.start({ address: '192.168.1.51' });
  await t.advance(5 * SECOND);
  await t.app.idle();
  const second = await t.app.acceptHeldIndex();
  assert.match(second.en, /A second click accepts/);
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1234.567);
});

test('accept: a jump grown beyond the margin between the clicks is not taken', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  t.alfa.set({ importWh: 1_234_567 + 1_000_000 });
  await t.wait(MINUTE);
  const first = await t.app.acceptHeldIndex();
  assert.match(first.en, /from 1234\.567 to 2234\.567 kWh/);
  // 100 kWh more in a minute: beyond 30 kW x the time between the clicks.
  t.alfa.set({ importWh: 1_234_567 + 1_100_000 });
  await t.wait(MINUTE + SECOND);
  const second = await t.app.acceptHeldIndex();
  assert.match(second.en, /Not accepted/);
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1234.567);
});

test('frozen: nothing published, not even the 10-minute heartbeat', async () => {
  const t = await setup({ devices: [created()] });
  // Every call counts: the fake's heartbeat follows the real clock, not this one.
  let calls = 0;
  const publish = t.gladys.publishChangedStates.bind(t.gladys);
  t.gladys.publishChangedStates = (...args) => {
    calls += 1;
    return publish(...args);
  };
  await t.start();
  await t.wait(FROZEN_AFTER + POLL_INTERVAL);
  assert.match(en(t.gladys.fake.connectionStatus), /No register of the Alfa has changed/);
  const count = t.gladys.fake.states.length;
  const before = calls;
  await t.wait(25 * MINUTE);
  assert.equal(t.gladys.fake.states.length, count);
  assert.equal(calls, before, 'publishChangedStates never called while frozen');
});

test('frozen: its age is kept in /data across a restart', async () => {
  const store = createMemoryStore();
  const t = await setup({ devices: [created()], store });
  await t.start();
  await t.wait(20 * MINUTE);
  await t.app.stop();
  const again = await setup({ devices: [created()], store, now: t.clock.now, alfa: t.alfa });
  await again.start();
  await again.wait(11 * MINUTE);
  assert.match(en(again.gladys.fake.connectionStatus), /No register of the Alfa has changed/);
});

test('the guards are in /data before Gladys gets the indexes', async () => {
  const store = createMemoryStore();
  const t = await setup({ devices: [created()], store });
  const seen = [];
  const publish = t.gladys.publishChangedStates.bind(t.gladys);
  t.gladys.publishChangedStates = (states, options) => {
    const index = states.find((s) => s.device_feature_external_id === F('import_index'));
    if (index) seen.push([index.state, store.data.indexes?.[F('import_index')]?.last?.value]);
    return publish(states, options);
  };
  await t.start();
  t.alfa.set({ importWh: 1_234_600 });
  await t.wait(MINUTE);
  assert.deepEqual(seen, [
    [1234.567, 1234.567],
    [1234.6, 1234.6],
  ]);
});

test('a late answer of an old session publishes nothing and feeds no guard', async () => {
  let release;
  const words = BATCHES.map(([start, count]) =>
    Array.from({ length: count }, (_, i) => registers({ importWh: 9_999_999 }).get(start + i) ?? 0),
  );
  const t = await setup({
    devices: [created()],
    makeClient: (options, n) =>
      n === 0
        ? {
            read: () => new Promise((resolve) => (release = () => resolve(words))),
            close() {},
          }
        : undefined,
  });
  await t.app.start({ address: '192.168.1.50' });
  await t.advance(0);
  await t.app.start({ address: '192.168.1.51' });
  await t.advance(0);
  const before = t.gladys.fake.states.length;
  const status = en(t.gladys.fake.connectionStatus);
  release();
  await t.advance(0);
  await t.app.idle();
  assert.equal(t.gladys.fake.states.length, before);
  assert.ok(!t.states('import_index').includes(9999.999));
  assert.equal(en(t.gladys.fake.connectionStatus), status);
  // Nor what the test button tells (the outcome of the new session).
  const told = await t.app.testConnection();
  assert.doesNotMatch(told.en, /9999\.999/);
  // The new session's guard never saw 9999.999.
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1234.567);
});

test('a crash during a read: after a restart, the next read waits the whole interval', async () => {
  const store = createMemoryStore();
  const t = await setup({ store });
  await t.start();
  await t.wait(POLL_INTERVAL);
  assert.equal(t.alfa.connections, 2);
  // The container dies right after the second read (no stop), restarts 1 s later.
  const again = await setup({ store, now: t.clock.now + SECOND, alfa: t.alfa });
  await again.start();
  await again.wait(27 * SECOND);
  assert.equal(t.alfa.connections, 2, 'no read sooner than 30 s after the last one');
  await again.wait(3 * SECOND);
  assert.equal(t.alfa.connections, 3);
});

test('a cut-off warning dated in the past: never "planned"; older than a day, no warning', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.set({ event: NOW / 1000 - 3600, left: 0xffff });
  await t.start();
  assert.match(en(t.gladys.fake.connectionStatus), /dated 2026-10-27 09:00 UTC \(already past\)/);
  assert.doesNotMatch(en(t.gladys.fake.connectionStatus), /planned/);
  assert.equal(t.states('cutoff_warning').at(-1), 1);
  t.alfa.set({ event: 1_600_000_000, left: 0xffff });
  await t.wait(POLL_INTERVAL);
  assert.equal(t.states('cutoff_warning').at(-1), 0);
  assert.match(
    en(t.gladys.fake.connectionStatus),
    /old cut-off warning, dated 2020-09-13 12:26 UTC/,
  );
  t.alfa.set({ event: 0xfffffffe, left: 30 });
  await t.wait(POLL_INTERVAL);
  assert.equal(t.states('cutoff_warning').at(-1), 0);
  assert.doesNotMatch(en(t.gladys.fake.connectionStatus), /Cut-off warning/);
});

test('frozen: a secondary batch that comes and goes never makes the values look new', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  for (let i = 0; i < 64; i += 1) {
    t.alfa.exceptions = i % 2 === 0 ? new Set([921]) : new Set();
    await t.wait(POLL_INTERVAL);
  }
  assert.match(en(t.gladys.fake.connectionStatus), /No register of the Alfa has changed/);
});
