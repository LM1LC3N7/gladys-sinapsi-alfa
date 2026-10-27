// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, an in-memory Alfa and a virtual clock.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AlfaApp } from '../../src/app.js';
import { ORDER, buildDevice } from '../../src/devices.js';
import { ModbusClient } from '../../src/alfa/client.js';
import { createMemoryStore } from '../../src/store.js';
import { createFakeAlfa } from '../fixtures/alfa.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'sinapsi-alfa';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** 2026-10-27 10:00 UTC. */
export const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);
export const ADDRESS = '192.168.1.50';
export const CONFIG = { address: ADDRESS };
export const DEVICE = `ext:${SELECTOR}:alfa:main`;
export const F = (key) => `${DEVICE}:${key}`;

/** The device as the user created it; `indexes`: { key: { value, at } } Gladys holds. */
export function created({ keys = ORDER, indexes = {} } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, new Set(keys), ADDRESS);
  for (const [key, last] of Object.entries(indexes)) {
    const feature = device.features.find((f) => f.external_id === F(key));
    feature.last_value = last.value;
    feature.last_value_changed = new Date(last.at).toISOString();
  }
  return device;
}

export async function setup({
  devices: known = [],
  store,
  now = NOW,
  alfa = createFakeAlfa(),
  config = CONFIG,
  wall = { offset: 0 },
  makeClient,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices: known });
  await gladys.connect();
  const { clock, timers, advance, pending } = createFakeClock(now);
  let drift = 0;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const kept = store ?? createMemoryStore();
  const clients = [];
  const app = new AlfaApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    // The wall clock may be set apart from the monotonic one (`wall.offset`);
    // it moves too between two reads of it.
    now: () => clock.now + wall.offset + (drift += 0.001),
    // A real monotonic clock moves between two reads of it: 1 µs per call
    // here, so that a decision reading the clock twice is caught.
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store: kept,
    clientFactory: (options) => {
      const client =
        makeClient?.(options, clients.length) ??
        new ModbusClient({ ...options, connect: () => alfa.connect() });
      clients.push(client);
      return client;
    },
  });
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  const wait = async (ms) => {
    await advance(ms);
    await app.idle();
  };
  /** The last states published for a feature key. */
  const states = (key) =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === F(key)).map((s) => s.state);
  return {
    app,
    gladys,
    clock,
    timers,
    store: kept,
    alfa,
    start,
    wait,
    advance,
    pending,
    lines,
    states,
    clients,
  };
}
