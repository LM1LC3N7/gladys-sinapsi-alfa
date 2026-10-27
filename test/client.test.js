// -----------------------------------------------------------------------------
// The Modbus TCP client (src/alfa/client.js) against real local TCP servers of
// gladys-testkit: framing, attribution of every answer, bounds, one request
// at a time, one connection at a time, closed after each read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blackhole, refusePort, tcpServer } from './kit/index.mjs';
import { ModbusClient, ModbusError } from '../src/alfa/client.js';
import { BATCHES, TIMINGS, UNIT_ID } from '../src/constants.js';
import { functionsOf, registers, respond } from './fixtures/alfa.js';

const FAST = { ...TIMINGS, connectTimeout: 500, requestTimeout: 300, closeWait: 200 };
const clientOf = (port, extra = {}) =>
  new ModbusClient({ host: '127.0.0.1', port, unitId: UNIT_ID, timings: FAST, ...extra });

async function device(options = {}) {
  const regs = registers();
  const dev = await tcpServer({ onData: (chunk) => respond(chunk, regs), ...options });
  return dev;
}

const kind = (expected) => (err) => err instanceof ModbusError && err.kind === expected;

test('a read: four batches, one after the other, then the connection closed', async (t) => {
  const dev = await device();
  t.after(() => dev.close());
  const client = clientOf(dev.port);
  const words = await client.read(BATCHES);
  assert.deepEqual(
    words.map((w) => w.length),
    BATCHES.map(([, count]) => count),
  );
  assert.equal(words[0][0], 850);
  // Each request in its own chunk: never two requests glued (no pipeline).
  assert.deepEqual(
    dev.received.map((r) => functionsOf(r.data)),
    [[3], [3], [3], [3]],
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(dev.open, 0, 'closed after the read');
  await client.read(BATCHES);
  assert.equal(dev.connections, 2);
  assert.equal(dev.peak, 1, 'never two connections at once');
});

test('a second read while one runs is refused, nothing sent', async (t) => {
  const dev = await device({ latencyMs: 50 });
  t.after(() => dev.close());
  const client = clientOf(dev.port);
  const first = client.read(BATCHES);
  await assert.rejects(client.read(BATCHES), kind('busy'));
  await first;
  assert.equal(dev.connections, 1);
});

test('answers that are not ours: wrong transaction, unit, function, length -> protocol, dropped', async (t) => {
  const cases = {
    tid: (chunk) => respond(chunk, registers(), { tid: (x) => x + 1 }),
    unit: (chunk) => respond(chunk, registers(), { unitId: 7 }),
    trailing: (chunk) => Buffer.concat([respond(chunk, registers()), Buffer.from([0])]),
    header: (chunk) => {
      const a = respond(chunk, registers());
      a.writeUInt16BE(1, 2);
      return a;
    },
    count: (chunk) => {
      const a = respond(chunk, registers());
      a[8] -= 2;
      return a;
    },
  };
  for (const [name, onData] of Object.entries(cases)) {
    const dev = await tcpServer({ onData });
    t.after(() => dev.close());
    await assert.rejects(clientOf(dev.port).read(BATCHES), kind('protocol'), name);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(dev.open, 0, `${name}: the connection is dropped`);
  }
});

test('an answer longer than a Modbus frame is cut before it is read whole', async (t) => {
  const dev = await tcpServer({ onData: () => Buffer.alloc(4096, 1) });
  t.after(() => dev.close());
  await assert.rejects(clientOf(dev.port).read(BATCHES), kind('protocol'));
});

test('a Modbus exception: refused with its code', async (t) => {
  const dev = await tcpServer({
    onData: (chunk) => {
      const tid = chunk.readUInt16BE(0);
      const frame = Buffer.from([0, 0, 0, 0, 0, 3, UNIT_ID, 0x83, 2]);
      frame.writeUInt16BE(tid, 0);
      return frame;
    },
  });
  t.after(() => dev.close());
  await assert.rejects(
    clientOf(dev.port).read(BATCHES),
    (err) => kind('exception')(err) && err.code === 2,
  );
});

test('silence: the request times out, the connection is closed, a late answer never taken', async (t) => {
  const regs = registers();
  let n = 0;
  const dev = await tcpServer({
    onData: (chunk) => respond(chunk, regs),
    latencyMs: () => (n++ === 0 ? 600 : 0),
  });
  t.after(() => dev.close());
  const client = clientOf(dev.port);
  await assert.rejects(client.read(BATCHES), kind('timeout'));
  const words = await client.read(BATCHES);
  assert.equal(words[0][0], 850);
  assert.equal(dev.peak, 1);
});

test('bytes nobody asked for drop the connection', async (t) => {
  const dev = await tcpServer({ onConnect: () => Buffer.from([1, 2, 3]) });
  t.after(() => dev.close());
  await assert.rejects(clientOf(dev.port).read(BATCHES), (err) => err instanceof ModbusError);
});

test('unreachable: refused port, and a host that never accepts in time', async (t) => {
  const port = await refusePort();
  await assert.rejects(clientOf(port).read(BATCHES), kind('unreachable'));
  const hole = await blackhole();
  t.after(() => hole.close());
  await assert.rejects(
    clientOf(hole.port, { timings: { ...FAST, readBudget: 400 } }).read(BATCHES),
    (err) => err instanceof ModbusError,
  );
});

test('the deadline of the whole read is kept', async (t) => {
  const dev = await device({ latencyMs: 150 });
  t.after(() => dev.close());
  const client = clientOf(dev.port);
  const started = performance.now();
  await assert.rejects(
    client.read(BATCHES, { by: performance.now() + 250 }),
    (err) => err instanceof ModbusError && ['timeout', 'late'].includes(err.kind),
  );
  assert.ok(performance.now() - started < 600);
});

test('close(): a stopped client never opens again', async (t) => {
  const dev = await device();
  t.after(() => dev.close());
  const client = clientOf(dev.port);
  client.close();
  await assert.rejects(client.read(BATCHES), kind('unreachable'));
  assert.equal(dev.connections, 0);
});

test('the client has no write function', async () => {
  const client = clientOf(1);
  assert.equal(typeof client.write, 'undefined');
  assert.equal(typeof client.writeRegister, 'undefined');
});
