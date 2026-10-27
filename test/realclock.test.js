// -----------------------------------------------------------------------------
// The app on a REAL moving clock (gladys-testkit realClock, sped up 20 times:
// 30 s of the interval are 1.5 s) and a real local TCP server playing the
// Alfa over Modbus TCP: the reads really start at 0, the interval and twice
// the interval, never sooner, with a bounded number of timers. The clock
// moves between any two reads of it. Run 20 times at once, with wide
// margins: late under load, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { measurePeriod, realClock, spyOn, tcpServer } from './kit/index.mjs';
import { AlfaApp } from '../src/app.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { registers, respond } from './fixtures/alfa.js';

const SPEED = 20;
const RUNS = 20;

async function oneRun(port) {
  const clock = realClock({ speed: SPEED });
  const gladys = createFakeGladys({ selector: 'sinapsi-alfa', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const app = new AlfaApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
  });
  // The method that runs once a read is decided (not the requests: their latency blurs the period).
  const spy = spyOn(app, 'readAll', clock);
  const started = clock.monotonic();
  try {
    await app.start({ address: `127.0.0.1:${port}` });
    const gaps = await measurePeriod(spy, { count: 3, period: POLL_INTERVAL });
    assert.equal(gaps.length, 2);
    assert.ok(spy.calls[0].at - started < POLL_INTERVAL / 2, 'the first read at once');
    assert.ok(clock.timersSet <= 40, `${clock.timersSet} timers`);
    assert.equal(gladys.fake.connectionStatus.connected, true);
  } finally {
    await app.stop();
    clock.close();
  }
}

test(`real clock x${SPEED}: reads at 0, the interval and twice the interval, ${RUNS} runs`, async (t) => {
  const regs = registers();
  const dev = await tcpServer({ onData: (chunk) => respond(chunk, regs) });
  t.after(() => dev.close());
  await Promise.all(Array.from({ length: RUNS }, () => oneRun(dev.port)));
  assert.ok(dev.connections >= 2 * RUNS, `${dev.connections} connections`);
});
