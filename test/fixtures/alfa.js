// -----------------------------------------------------------------------------
// A fake Sinapsi Alfa: its holding registers, a Modbus TCP responder (used by
// the real local TCP server of gladys-testkit and by an in-memory socket for
// the tests on a virtual clock).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

/** The values of a home with solar panels, in W and Wh. */
export const DEFAULTS = {
  importPower: 850,
  importWh: 1_234_567,
  importAverage: 800,
  exportPower: 0,
  exportWh: 345_678,
  exportAverage: 0,
  band: 2,
  event: 0xffffffff,
  left: 0xffff,
  productionPower: 120,
  productionWh: 400_000,
};

/** The register map (address -> word) of values like DEFAULTS. */
export function registers(values = {}) {
  const v = { ...DEFAULTS, ...values };
  const map = new Map();
  const u32 = (address, value) => {
    map.set(address, Math.floor(value / 0x10000) & 0xffff);
    map.set(address + 1, value & 0xffff);
  };
  map.set(2, v.importPower);
  u32(5, v.importWh);
  map.set(9, v.importAverage);
  map.set(12, v.exportPower);
  u32(15, v.exportWh);
  map.set(19, v.exportAverage);
  map.set(203, v.band);
  u32(780, v.event);
  map.set(782, v.left);
  map.set(921, v.productionPower);
  u32(924, v.productionWh);
  return map;
}

/**
 * The answers to the Modbus TCP requests of `chunk` (one or more frames),
 * from `regs` (a Map, or a function returning one). Read holding registers
 * only; any other function gets exception 1. `options.exceptions`: the
 * start addresses refused with exception 2. `options.unitId` (1),
 * `options.tid` (a function changing the transaction id answered).
 */
export function respond(chunk, regs, options = {}) {
  const out = [];
  let offset = 0;
  while (offset + 7 <= chunk.length) {
    const tid = chunk.readUInt16BE(offset);
    const length = chunk.readUInt16BE(offset + 4);
    const unit = chunk.readUInt8(offset + 6);
    const pdu = chunk.subarray(offset + 7, offset + 6 + length);
    offset += 6 + length;
    const map = typeof regs === 'function' ? regs() : regs;
    let body;
    if (pdu[0] === 3 && options.exceptions?.has(pdu.readUInt16BE(1))) {
      // Exception 2: illegal data address.
      body = Buffer.from([0x83, 2]);
    } else if (pdu[0] === 3) {
      const start = pdu.readUInt16BE(1);
      const count = pdu.readUInt16BE(3);
      body = Buffer.alloc(2 + count * 2);
      body[0] = 3;
      body[1] = count * 2;
      for (let i = 0; i < count; i += 1) {
        body.writeUInt16BE(map.get(start + i) ?? 0, 2 + i * 2);
      }
    } else {
      body = Buffer.from([pdu[0] | 0x80, 1]);
    }
    const frame = Buffer.alloc(7 + body.length);
    frame.writeUInt16BE(options.tid ? options.tid(tid) : tid, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(body.length + 1, 4);
    frame.writeUInt8(options.unitId ?? unit, 6);
    body.copy(frame, 7);
    out.push(frame);
  }
  return Buffer.concat(out);
}

/** The function codes of the requests of a chunk. */
export function functionsOf(chunk) {
  const codes = [];
  let offset = 0;
  while (offset + 8 <= chunk.length) {
    codes.push(chunk[offset + 7]);
    offset += 6 + chunk.readUInt16BE(offset + 4);
  }
  return codes;
}

/**
 * An in-memory Alfa for the tests on a virtual clock: `connect()` gives a
 * socket answering at once (in a microtask), unless `mode` says otherwise:
 * 'refuse' (ECONNREFUSED), 'silent' (connects, never answers), 'hang'
 * (never connects), 'garbage' (answers bytes that are not Modbus).
 * `regs` may be changed between reads. Counters: connections, open, peak,
 * requests (function codes).
 */
export function createFakeAlfa(values = {}) {
  const alfa = {
    regs: registers(values),
    mode: 'ok',
    /** Start addresses of the batches refused (Modbus exception 2). */
    exceptions: new Set(),
    connections: 0,
    open: 0,
    peak: 0,
    requests: [],
    set(next) {
      alfa.regs = registers(next);
    },
    connect() {
      const socket = new EventEmitter();
      socket.destroyed = false;
      socket.closed = false;
      socket.writable = true;
      socket.setNoDelay = () => {};
      const mode = alfa.mode;
      const close = () => {
        if (socket.closed) return;
        socket.closed = true;
        if (socket.connected) alfa.open -= 1;
        queueMicrotask(() => socket.emit('close'));
      };
      socket.destroy = () => {
        if (socket.destroyed) return;
        socket.destroyed = true;
        socket.writable = false;
        close();
      };
      socket.write = (frame) => {
        if (socket.destroyed) return false;
        alfa.requests.push(...functionsOf(frame));
        if (alfa.mode === 'silent') return true;
        const answer =
          alfa.mode === 'garbage'
            ? Buffer.from('HTTP/1.1 400 Bad\r\n\r\n')
            : respond(frame, alfa.regs, { exceptions: alfa.exceptions });
        queueMicrotask(() => {
          if (!socket.destroyed) socket.emit('data', answer);
        });
        return true;
      };
      queueMicrotask(() => {
        if (mode === 'refuse') {
          socket.destroyed = true;
          socket.closed = true;
          socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
          socket.emit('close');
          return;
        }
        if (mode === 'hang') return;
        alfa.connections += 1;
        socket.connected = true;
        alfa.open += 1;
        alfa.peak = Math.max(alfa.peak, alfa.open);
        socket.emit('connect');
      });
      return socket;
    },
  };
  return alfa;
}
