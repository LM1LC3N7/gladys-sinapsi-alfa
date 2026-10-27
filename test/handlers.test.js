// -----------------------------------------------------------------------------
// The exact wiring of the container (src/handlers.js) against the SDK's fake
// Gladys: a getConfig that fails in the 'connected' handler is read again
// until it comes, at the first connection and at a reconnection.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AlfaApp } from '../src/app.js';
import { ModbusClient } from '../src/alfa/client.js';
import { registerHandlers } from '../src/handlers.js';
import { createMemoryStore } from '../src/store.js';
import { ACTIONS } from '../src/constants.js';
import { createFakeAlfa } from './fixtures/alfa.js';
import { createFakeClock } from './helpers/fakeTimers.js';
import { CONFIG, NOW, SECOND, created } from './helpers/app.js';

const en = (status) => status?.message?.en ?? '';

async function wired({ failures }) {
  const gladys = createFakeGladys({
    selector: 'sinapsi-alfa',
    config: CONFIG,
    devices: [created()],
  });
  const { clock, timers, advance } = createFakeClock(NOW);
  let drift = 0;
  const alfa = createFakeAlfa();
  const quiet = () => {};
  const app = new AlfaApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: () => clock.now + (drift += 0.001),
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store: createMemoryStore(),
    clientFactory: (options) => new ModbusClient({ ...options, connect: () => alfa.connect() }),
  });
  registerHandlers(gladys, app, { info: quiet, warn: quiet, error: quiet });
  const getConfig = gladys.getConfig.bind(gladys);
  // The SDK reads the configuration itself before 'connected' (its
  // resynchronization): that read passes; the ones of the handler fail
  // while `failures.count` says so.
  let calls = 0;
  let resync = false;
  gladys.getConfig = async () => {
    if (resync) {
      resync = false;
      return getConfig();
    }
    calls += 1;
    if (failures.count > 0) {
      failures.count -= 1;
      throw new Error('Gladys busy');
    }
    return getConfig();
  };
  const connect = async () => {
    resync = true;
    await gladys.connect();
  };
  return { gladys, app, alfa, advance, connect, calls: () => calls };
}

test('connected: getConfig fails once, the status says so, then the reads start', async () => {
  const failures = { count: 1 };
  const t = await wired({ failures });
  await t.connect();
  await t.app.idle();
  assert.equal(t.alfa.connections, 0);
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(en(t.gladys.fake.connectionStatus), /could not be read from Gladys: new try in 5 s/);
  await t.advance(5 * SECOND);
  await t.app.idle();
  await t.advance(0);
  await t.app.idle();
  assert.equal(t.calls(), 2, 'one failure, one success');
  assert.equal(t.alfa.connections, 1);
  assert.equal(t.gladys.fake.connectionStatus.connected, true);
  assert.ok(t.gladys.fake.lastState('ext:sinapsi-alfa:alfa:main:import_index') > 0);
});

test('a reconnection whose getConfig fails keeps reading with the last configuration', async () => {
  const failures = { count: 0 };
  const t = await wired({ failures });
  await t.connect();
  await t.advance(0);
  await t.app.idle();
  assert.equal(t.alfa.connections, 1);
  await t.gladys.disconnect();
  await t.app.idle();
  failures.count = 2;
  await t.connect();
  await t.app.idle();
  assert.match(en(t.gladys.fake.connectionStatus), /could not be read again from Gladys/);
  // 5 s, then 10 s: the third read of the configuration passes.
  await t.advance(15 * SECOND);
  await t.app.idle();
  await t.advance(15 * SECOND);
  await t.app.idle();
  assert.equal(t.calls(), 4);
  assert.equal(t.alfa.connections, 2, 'the reads went on');
  assert.doesNotMatch(en(t.gladys.fake.connectionStatus), /could not be read/);
});

test('the buttons are wired; no command handler (read-only)', async () => {
  const t = await wired({ failures: { count: 0 } });
  await t.connect();
  await t.advance(0);
  await t.app.idle();
  const ack = await t.gladys.fake.action(ACTIONS.TEST);
  assert.match(JSON.stringify(ack), /Alfa at 192\.168\.1\.50/);
  const accept = await t.gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(JSON.stringify(accept), /No index is held back/);
});
