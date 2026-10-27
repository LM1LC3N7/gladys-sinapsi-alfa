// -----------------------------------------------------------------------------
// The app on a virtual clock (every read of the clock moves it), against the
// SDK's fake Gladys and an in-memory Alfa.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AlfaApp } from '../src/app.js';
import { POLL_INTERVAL, FROZEN_AFTER } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { ORDER } from '../src/devices.js';
import { DEVICE, F, HOUR, MINUTE, NOW, SECOND, created, setup } from './helpers/app.js';

const en = (status) => status?.message?.en ?? '';

test('first read at once, then every 30 s; one connection per read, closed after it', async () => {
  const t = await setup();
  await t.start();
  assert.equal(t.alfa.connections, 1);
  assert.equal(t.alfa.open, 0, 'closed after the read');
  assert.deepEqual(t.alfa.requests, [3, 3, 3, 3], 'four reads of holding registers, nothing else');
  await t.wait(POLL_INTERVAL - SECOND);
  assert.equal(t.alfa.connections, 1, 'never sooner than the interval');
  await t.wait(SECOND);
  assert.equal(t.alfa.connections, 2);
  assert.equal(t.alfa.peak, 1, 'never two connections at once');
  assert.ok(
    t.alfa.requests.every((fn) => fn === 3),
    'read-only',
  );
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
  assert.match(en(t.gladys.fake.connectionStatus), /Create its device/);
  const [device] = t.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    ORDER.filter((k) => k !== 'cutoff_seconds_left'),
  );
});

test('the values of a created device; the indexes once a minute', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  assert.deepEqual(t.states('import_power'), [850]);
  assert.deepEqual(t.states('power'), [850 + 120]);
  assert.deepEqual(t.states('production_power'), [120]);
  assert.deepEqual(t.states('export_power'), [0]);
  assert.deepEqual(t.states('import_index'), [1234.567]);
  assert.deepEqual(t.states('export_index'), [345.678]);
  assert.deepEqual(t.states('production_index'), [400]);
  assert.deepEqual(t.states('tariff_band'), [2]);
  assert.deepEqual(t.states('cutoff_warning'), [0]);
  assert.deepEqual(t.states('cutoff_seconds_left'), []);
  assert.match(
    en(t.gladys.fake.connectionStatus),
    /^Connected to the Sinapsi Alfa at 192\.168\.1\.50\.$/,
  );
  t.alfa.set({ importWh: 1_234_600, importPower: 900 });
  await t.wait(POLL_INTERVAL);
  assert.deepEqual(t.states('import_power'), [850, 900]);
  assert.deepEqual(t.states('import_index'), [1234.567], 'not yet a minute');
  await t.wait(POLL_INTERVAL);
  assert.deepEqual(t.states('import_index'), [1234.567, 1234.6]);
});

test('starting (registers at 0): nothing published, status says so, then values', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.set({ importWh: 0, band: 0, importPower: 0 });
  await t.start();
  assert.equal(t.gladys.fake.states.length, 0);
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(en(t.gladys.fake.connectionStatus), /still starting/);
  t.alfa.set({ band: 0 });
  await t.wait(POLL_INTERVAL);
  assert.equal(t.gladys.fake.states.length, 0, 'the band alone at 0 is enough');
  t.alfa.set({});
  await t.wait(POLL_INTERVAL);
  assert.deepEqual(t.states('import_index'), [1234.567]);
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
});

test('a lifetime index at 0 or lower after a restart of the Alfa: held, never published', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  // The production register drops to a smaller value (another device, a reset).
  t.alfa.set({ productionWh: 350_000, exportWh: 345_678 });
  await t.wait(MINUTE);
  assert.deepEqual(t.states('production_index'), [400], 'the last accepted value, never 350');
  assert.match(
    en(t.gladys.fake.connectionStatus),
    /Energy produced index held back.*dropped from 400 to 350 kWh/,
  );
  // The export total jumps by 10 MWh in a minute.
  t.alfa.set({ productionWh: 350_000, exportWh: 345_678 + 10_000_000 });
  await t.wait(MINUTE);
  const last = t.states('export_index').at(-1);
  assert.equal(last, 345.678);
  assert.ok(!t.states('import_index').includes(0));
});

test('accept the held index: two clicks, only what was listed', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  t.alfa.set({ importWh: 1000 });
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1234.567);
  const first = await t.app.acceptHeldIndex();
  assert.match(first.en, /Energy drawn: from 1234\.567 down to 1 kWh/);
  await t.advance(SECOND);
  const tooSoon = await t.app.acceptHeldIndex();
  assert.match(tooSoon.en, /A second click/, 'a second click too soon is a first click again');
  await t.advance(5 * SECOND);
  const done = await t.app.acceptHeldIndex();
  assert.match(done.en, /Accepted: Energy drawn 1 kWh/);
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1);
  assert.doesNotMatch(en(t.gladys.fake.connectionStatus), /held back/);
  assert.match((await t.app.acceptHeldIndex()).en, /No index is held back/);
});

test('a save of the form never accepts; a held index stays held across a restart', async () => {
  const store = createMemoryStore();
  const t = await setup({ devices: [created()], store });
  await t.start();
  t.alfa.set({ importWh: 5000 });
  await t.wait(MINUTE);
  await t.app.start({ address: '192.168.1.50', max_power_kw: 100 });
  await t.wait(MINUTE);
  assert.equal(t.states('import_index').at(-1), 1234.567);
  await t.app.stop();
  const again = await setup({
    devices: [created()],
    store,
    now: t.clock.now + MINUTE,
    alfa: t.alfa,
  });
  await again.start();
  assert.equal(again.states('import_index').at(-1), 1234.567);
  assert.match(en(again.gladys.fake.connectionStatus), /Energy drawn index held back/);
});

test('unreachable: retries 30 s doubled, the status says why; values back after', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.mode = 'refuse';
  await t.start();
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(en(t.gladys.fake.connectionStatus), /no Modbus TCP connection.*new try in 30 s/);
  await t.wait(30 * SECOND);
  assert.match(en(t.gladys.fake.connectionStatus), /new try in 1 min/);
  t.alfa.mode = 'ok';
  await t.wait(MINUTE);
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(t.states('import_power'), [850]);
});

test('a silent Alfa: the request times out, the connection is closed, never two open', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.mode = 'silent';
  await t.app.start({ address: '192.168.1.50' });
  await t.advance(0);
  await t.advance(6 * SECOND);
  await t.app.idle();
  assert.match(en(t.gladys.fake.connectionStatus), /no answer in time/);
  assert.equal(t.alfa.open, 0);
  assert.deepEqual(t.alfa.requests, [3], 'one request, no pipeline');
  assert.equal(t.gladys.fake.states.length, 0);
});

test('an answer that is not Modbus: protocol error, nothing published', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.mode = 'garbage';
  await t.start();
  assert.match(en(t.gladys.fake.connectionStatus), /not the one asked/);
  assert.equal(t.gladys.fake.states.length, 0);
});

test('the pace survives a restart: the time of the last read is in /data', async () => {
  const store = createMemoryStore();
  const t = await setup({ store });
  await t.start();
  await t.app.stop();
  const again = await setup({ store, now: t.clock.now + 10 * SECOND, alfa: t.alfa });
  await again.start();
  assert.equal(t.alfa.connections, 1, 'no read 10 s after the last one');
  await again.wait(21 * SECOND);
  assert.equal(t.alfa.connections, 2);
});

test('the test button never reads sooner than the interval', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  const answer = await t.app.testConnection();
  assert.equal(t.alfa.connections, 1);
  assert.match(answer.en, /Last read .* ago: Alfa at 192\.168\.1\.50, drawn 850 W/);
  assert.match(answer.en, /energy drawn 1234\.567 kWh/);
  await t.advance(POLL_INTERVAL);
  await t.app.idle();
  assert.equal(t.alfa.connections, 2);
});

test('frozen registers: nothing published after FROZEN_AFTER, the status says so', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  const before = t.gladys.fake.states.length;
  await t.wait(FROZEN_AFTER - POLL_INTERVAL);
  const during = t.gladys.fake.states.length;
  assert.ok(during >= before);
  await t.wait(2 * POLL_INTERVAL);
  assert.match(en(t.gladys.fake.connectionStatus), /No register of the Alfa has changed/);
  const frozen = t.gladys.fake.states.length;
  await t.wait(10 * MINUTE);
  assert.equal(t.gladys.fake.states.length, frozen, 'nothing sent while frozen');
  t.alfa.set({ importPower: 851 });
  await t.wait(POLL_INTERVAL);
  assert.ok(t.gladys.fake.states.length > frozen);
});

test('the cut-off warning: binary, seconds left, and the status', async () => {
  const t = await setup({ devices: [created()] });
  const at = NOW / 1000;
  t.alfa.set({ event: at, left: 600 });
  await t.start();
  assert.deepEqual(t.states('cutoff_warning'), [1]);
  assert.deepEqual(t.states('cutoff_seconds_left'), [600]);
  assert.match(en(t.gladys.fake.connectionStatus), /Cut-off warning.*2026-10-27 10:10 UTC/);
  t.alfa.set({});
  await t.wait(POLL_INTERVAL);
  assert.deepEqual(t.states('cutoff_warning'), [1, 0]);
});

test('an address change: the old session publishes nothing, the device stays', async () => {
  const t = await setup({ devices: [created()] });
  await t.start();
  await t.app.start({ address: '192.168.1.51' });
  await t.advance(0);
  await t.app.idle();
  assert.equal(t.clients.length, 2);
  assert.equal(t.alfa.peak, 1);
  assert.equal(t.gladys.fake.discoveredDevices[0].external_id, DEVICE);
});

test('/data unreadable: never written over, the status says so', async () => {
  const store = createMemoryStore();
  store.load = () => ({ unreadable: true });
  let saves = 0;
  store.save = async () => {
    saves += 1;
  };
  const t = await setup({ devices: [created()], store });
  await t.start();
  assert.equal(saves, 0);
  assert.match(en(t.gladys.fake.connectionStatus), /cannot be read/);
});

test('a created device: its indexes start from what Gladys holds', async () => {
  const t = await setup({
    devices: [created({ indexes: { import_index: { value: 1234, at: NOW - HOUR } } })],
  });
  await t.start();
  assert.deepEqual(t.states('import_index'), [1234.567]);
  const device = created({ indexes: { import_index: { value: 1300, at: NOW - HOUR } } });
  const u = await setup({ devices: [device] });
  await u.start();
  assert.deepEqual(u.states('import_index'), [1300], 'a drop from what Gladys holds is held');
});

test('only the features of the created device are published', async () => {
  const t = await setup({ devices: [created({ keys: ['import_power', 'import_index'] })] });
  await t.start();
  const ids = new Set(t.gladys.fake.states.map((s) => s.device_feature_external_id));
  assert.deepEqual([...ids].sort(), [F('import_index'), F('import_power')]);
});

test('connectedFrom: a getConfig that fails is retried, 5 s doubled, with a status', async () => {
  const gladys = createFakeGladys({ selector: 'sinapsi-alfa', config: {} });
  await gladys.connect();
  const timers = [];
  const app = new AlfaApp({
    gladys,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: () => NOW,
    monotonic: (() => {
      let m = 0;
      return () => (m += 0.001);
    })(),
    timers: {
      setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
      clearTimeout: () => {},
    },
    store: createMemoryStore(),
    clientFactory: () => ({ read: () => new Promise(() => {}), close() {} }),
  });
  let calls = 0;
  const read = async () => {
    calls += 1;
    if (calls <= 2) throw new Error('down');
    return { address: '192.168.1.50' };
  };
  await app.connectedFrom(read);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(en(gladys.fake.connectionStatus), /could not be read from Gladys: new try in 5 s/);
  assert.equal(timers.at(-1).ms, 5 * SECOND);
  await timers.at(-1).fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(timers.at(-1).ms, 10 * SECOND);
  await timers.at(-1).fn();
  await app.idle();
  assert.equal(calls, 3);
  assert.equal(app.config.address.host, '192.168.1.50');
  assert.doesNotMatch(en(gladys.fake.connectionStatus), /could not be read from Gladys/);
});

test('a secondary batch refused (exception): the other values go on, the status says so', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.exceptions = new Set([780, 921]);
  await t.start();
  assert.deepEqual(t.states('import_power'), [850]);
  assert.deepEqual(t.states('import_index'), [1234.567]);
  assert.deepEqual(t.states('production_index'), []);
  assert.deepEqual(t.states('cutoff_warning'), []);
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
  assert.match(
    en(t.gladys.fake.connectionStatus),
    /refuses the registers of: cut-off warning, production/,
  );
  // The grid batch is required.
  t.alfa.exceptions = new Set([2]);
  await t.wait(POLL_INTERVAL);
  assert.match(en(t.gladys.fake.connectionStatus), /Modbus request refused \(2\)/);
});

test('a stop closes the connection of a read running; nothing of it is published', async () => {
  const t = await setup({ devices: [created()] });
  t.alfa.mode = 'silent';
  await t.app.start({ address: '192.168.1.50' });
  await t.advance(0);
  assert.equal(t.alfa.open, 1, 'a read waits for its answer');
  await t.app.stop();
  await t.advance(0);
  assert.equal(t.alfa.open, 0, 'closed by the stop');
  t.alfa.mode = 'ok';
  await t.advance(10 * SECOND);
  await t.app.idle();
  assert.equal(t.gladys.fake.states.length, 0);
  await t.start();
  await t.wait(POLL_INTERVAL);
  assert.ok(t.states('import_power').length > 0, 'a new session after the stop reads again');
});

test('configurations saved in a row apply one after the other, the last one wins', async () => {
  const t = await setup();
  const a = t.app.start({ address: '192.168.1.60' });
  const b = t.app.start({ address: 'nope..' });
  const c = t.app.start({ address: '192.168.1.61:1502' });
  await Promise.all([a, b, c]);
  await t.advance(0);
  await t.app.idle();
  assert.deepEqual(t.app.config.address, { host: '192.168.1.61', port: 1502 });
  assert.match(en(t.gladys.fake.connectionStatus), /192\.168\.1\.61:1502/);
  assert.equal(t.alfa.peak, 1);
});

test('a read asked before its time (any path) does nothing', async () => {
  const t = await setup();
  await t.start();
  await t.app.tick();
  await t.advance(10 * SECOND);
  await t.app.tick();
  assert.equal(t.alfa.connections, 1);
});
