// -----------------------------------------------------------------------------
// A minimal, read-only Modbus TCP client on node:net: read holding registers
// (function 3), the only function this integration ever sends. Written here
// rather than taken from npm, as gladys-stiebel-eltron's and gladys-ctc's
// (approved), from which it is cut down (see TODO.md "Decisions"):
//
//   - one connection per read, opened for it and closed after it, as the
//     reference does: the Alfa serves a single Modbus client, so it is held
//     only a few hundred milliseconds every 30 s. A new connection opens only
//     once the previous one is closed (or after TIMINGS.closeWait);
//   - one request at a time, never two on the wire (no pipeline): a read is
//     one connection running its requests one after the other; a second read
//     asked while one runs is refused BUSY, nothing sent;
//   - every answer attributed to its request: transaction id, protocol id 0,
//     unit id and function must all match, the byte count must be the one
//     asked; anything else is a PROTOCOL error and the connection is dropped;
//   - bounded: a frame is 260 bytes at most, a read 125 registers at most; a
//     byte beyond the frame, or arriving with no request in flight, drops the
//     connection; a request without its answer in time drops it too, so a
//     late answer is never taken for the next one; the whole read has a
//     deadline (`by`, monotonic).
// Never a write: there is no write function in this file.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { LIMITS, TIMINGS } from '../constants.js';

export const ERROR_KINDS = {
  /** No TCP connection could be opened: nothing was sent. */
  UNREACHABLE: 'unreachable',
  /** Sent, no complete answer in time (the connection is dropped). */
  TIMEOUT: 'timeout',
  /** The connection closed while a request was in flight. */
  CLOSED: 'closed',
  /** An answer that does not belong to the request (the connection is dropped). */
  PROTOCOL: 'protocol',
  /** A Modbus exception answer (code 1 to 11): the Alfa refused the request. */
  EXCEPTION: 'exception',
  /** The deadline of the read passed before a request could leave. */
  LATE: 'late',
  /** A read already runs: nothing sent. */
  BUSY: 'busy',
};

export class ModbusError extends Error {
  constructor(kind, { code, detail } = {}) {
    super(code === undefined ? kind : `${kind} ${code}`);
    this.name = 'ModbusError';
    this.kind = kind;
    this.code = code;
    this.detail = detail;
  }
}

const READ_HOLDING = 3;
const HEADER = 7;

export class ModbusClient {
  constructor({
    host,
    port,
    unitId,
    connect = (options) => net.createConnection(options),
    timers = globalThis,
    monotonic = () => performance.now(),
    timings = TIMINGS,
  }) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.connect = connect;
    this.timers = timers;
    this.monotonic = monotonic;
    this.timings = timings;
    this.socket = undefined;
    this.pending = undefined;
    this.transaction = 0;
    this.active = false;
    this.stopped = false;
    /** The previous socket being closed: resolves once it is (or after closeWait). */
    this.closing = undefined;
  }

  /**
   * One read: a connection, the `batches` (`[[start, count], ...]`) read one
   * after the other, the connection closed. Resolves with the words of each
   * batch; rejects with a ModbusError (the connection closed too).
   *
   * A batch listed in `optional` (indexes) never blocks the others: it waits
   * `timings.requestTimeout` at most for its answer, as the grid batch (the
   * reference never waits less than 5 s); refused (a Modbus
   * exception, the connection stays) or not answered (timeout, closed, wrong
   * answer: the connection is dropped, and the batches left are not tried
   * this time), it gives `undefined` and the read resolves with the rest.
   * A batch listed in `skip` is not asked (undefined). `missed` (a Map, if
   * given) gets `index -> 'refused' | 'silent' | 'skipped' | 'not_tried'`.
   * `by`: the monotonic deadline of the whole read.
   */
  async read(
    batches,
    {
      by = this.monotonic() + this.timings.readBudget,
      optional = [],
      skip = [],
      missed = new Map(),
    } = {},
  ) {
    if (this.active) {
      throw new ModbusError(ERROR_KINDS.BUSY);
    }
    this.active = true;
    try {
      await this.open(by);
      const words = [];
      let broken = false;
      for (const [i, [start, count]] of batches.entries()) {
        const isOptional = optional.includes(i);
        if (isOptional && (broken || skip.includes(i))) {
          missed.set(i, broken ? 'not_tried' : 'skipped');
          words.push(undefined);
          continue;
        }
        try {
          words.push(await this.readHolding(start, count, by));
        } catch (err) {
          if (!isOptional || !(err instanceof ModbusError)) {
            throw err;
          }
          const refused = err.kind === ERROR_KINDS.EXCEPTION;
          // LATE: the deadline of the read passed, nothing sent for it.
          missed.set(
            i,
            refused ? 'refused' : err.kind === ERROR_KINDS.LATE ? 'not_tried' : 'silent',
          );
          // Anything but a well-formed refusal dropped the connection.
          broken = !refused;
          words.push(undefined);
        }
      }
      return words;
    } finally {
      this.closeSocket();
      this.active = false;
    }
  }

  /** Stops for good: the connection is dropped, a request in flight fails CLOSED. */
  close() {
    this.stopped = true;
    this.drop(new ModbusError(ERROR_KINDS.CLOSED));
  }

  // --- Requests ----------------------------------------------------------------

  readHolding(address, count, by, within = this.timings.requestTimeout) {
    if (
      !Number.isInteger(address) ||
      !Number.isInteger(count) ||
      address < 0 ||
      count < 1 ||
      count > LIMITS.registersPerRead ||
      address + count > 0x10000
    ) {
      return Promise.reject(new RangeError('Invalid Modbus read'));
    }
    const pdu = Buffer.from([READ_HOLDING, address >> 8, address & 0xff, count >> 8, count & 0xff]);
    return this.transact(pdu, by, within, (answer) => {
      const bytes = answer[1];
      if (answer.length < 2 || bytes !== count * 2 || answer.length !== 2 + bytes) {
        throw new ModbusError(ERROR_KINDS.PROTOCOL, { detail: 'byte count' });
      }
      const words = [];
      for (let i = 0; i < count; i += 1) {
        words.push(answer.readUInt16BE(2 + i * 2));
      }
      return words;
    });
  }

  /** One request and its answer, within `within` ms and before the deadline `by` (monotonic). */
  transact(pdu, by, within, check) {
    const socket = this.socket;
    if (this.stopped || !socket || socket.destroyed || socket.writable === false) {
      return Promise.reject(new ModbusError(ERROR_KINDS.CLOSED));
    }
    if (this.pending) {
      // Never two requests on the wire.
      return Promise.reject(new ModbusError(ERROR_KINDS.BUSY));
    }
    const mono = this.monotonic();
    if (mono >= by) {
      return Promise.reject(new ModbusError(ERROR_KINDS.LATE));
    }
    const wait = Math.min(within, by - mono);
    this.transaction = (this.transaction % 0xffff) + 1;
    const tid = this.transaction;
    const frame = Buffer.alloc(HEADER + pdu.length);
    frame.writeUInt16BE(tid, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(pdu.length + 1, 4);
    frame.writeUInt8(this.unitId, 6);
    pdu.copy(frame, HEADER);
    return new Promise((resolve, reject) => {
      const pending = {
        tid,
        fn: pdu[0],
        check,
        buffer: Buffer.alloc(0),
        resolve,
        reject,
        timer: undefined,
      };
      pending.timer = this.timers.setTimeout(
        () => this.fail(pending, new ModbusError(ERROR_KINDS.TIMEOUT), true),
        wait,
      );
      this.pending = pending;
      socket.write(frame);
    });
  }

  // --- Connection ----------------------------------------------------------------

  /** The connection of this read, once the previous one is closed; gives up at `by`. */
  async open(by) {
    if (this.closing) {
      await this.closing;
    }
    if (this.stopped) {
      throw new ModbusError(ERROR_KINDS.UNREACHABLE);
    }
    const wait = Math.min(this.timings.connectTimeout, by - this.monotonic());
    if (!(wait > 0)) {
      throw new ModbusError(ERROR_KINDS.LATE);
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const give = (err) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(timer);
        socket?.destroy();
        reject(err);
      };
      const timer = this.timers.setTimeout(
        () => give(new ModbusError(ERROR_KINDS.UNREACHABLE, { detail: 'connect timeout' })),
        wait,
      );
      try {
        socket = this.connect({ host: this.host, port: this.port });
      } catch {
        give(new ModbusError(ERROR_KINDS.UNREACHABLE));
        return;
      }
      socket.on('error', () => give(new ModbusError(ERROR_KINDS.UNREACHABLE)));
      socket.once('close', () => give(new ModbusError(ERROR_KINDS.UNREACHABLE)));
      socket.once('connect', () => {
        if (settled) {
          socket.destroy();
          return;
        }
        if (this.stopped) {
          give(new ModbusError(ERROR_KINDS.UNREACHABLE));
          return;
        }
        settled = true;
        this.timers.clearTimeout(timer);
        socket.setNoDelay?.(true);
        this.socket = socket;
        socket.on('data', (chunk) => this.receive(socket, chunk));
        socket.on('close', () => {
          if (this.socket === socket) {
            this.drop(new ModbusError(ERROR_KINDS.CLOSED));
          }
        });
        resolve();
      });
    });
  }

  /** Closes the connection of a read. */
  closeSocket() {
    this.drop(new ModbusError(ERROR_KINDS.CLOSED));
  }

  /**
   * The next connection opens once this socket is closed (its 'close'
   * event), or after TIMINGS.closeWait: never two connections at once.
   */
  waitClosed(socket) {
    let timer;
    const closed = new Promise((resolve) => {
      if (socket.closed === true) {
        resolve();
        return;
      }
      socket.once('close', resolve);
      timer = this.timers.setTimeout(resolve, this.timings.closeWait);
    }).finally(() => {
      this.timers.clearTimeout(timer);
      if (this.closing === closed) this.closing = undefined;
    });
    this.closing = closed;
  }

  receive(socket, chunk) {
    if (socket !== this.socket) {
      return;
    }
    const pending = this.pending;
    if (!pending) {
      // Nothing was asked: not an answer of ours.
      this.drop(new ModbusError(ERROR_KINDS.PROTOCOL, { detail: 'unasked' }));
      return;
    }
    if (pending.buffer.length + chunk.length > LIMITS.frameBytes) {
      this.fail(pending, new ModbusError(ERROR_KINDS.PROTOCOL, { detail: 'too long' }), true);
      return;
    }
    pending.buffer = Buffer.concat([pending.buffer, chunk]);
    const fail = (detail) =>
      this.fail(pending, new ModbusError(ERROR_KINDS.PROTOCOL, { detail }), true);
    const buffer = pending.buffer;
    if (buffer.length < HEADER) {
      return;
    }
    const length = buffer.readUInt16BE(4);
    if (buffer.readUInt16BE(2) !== 0 || length < 2 || length > LIMITS.frameBytes - 6) {
      fail('header');
      return;
    }
    const total = 6 + length;
    if (buffer.length < total) {
      return;
    }
    if (buffer.length > total) {
      fail('trailing bytes');
      return;
    }
    if (buffer.readUInt16BE(0) !== pending.tid || buffer.readUInt8(6) !== this.unitId) {
      fail('transaction');
      return;
    }
    const answer = buffer.subarray(HEADER, total);
    if (answer[0] === (pending.fn | 0x80)) {
      if (answer.length !== 2) {
        fail('exception');
        return;
      }
      this.fail(pending, new ModbusError(ERROR_KINDS.EXCEPTION, { code: answer[1] }));
      return;
    }
    if (answer[0] !== pending.fn) {
      fail('function');
      return;
    }
    let value;
    try {
      value = pending.check(answer);
    } catch (err) {
      this.fail(pending, err, true);
      return;
    }
    this.settle(pending);
    pending.resolve(value);
  }

  settle(pending) {
    this.timers.clearTimeout(pending.timer);
    if (this.pending === pending) {
      this.pending = undefined;
    }
  }

  fail(pending, err, dropConnection = false) {
    if (this.pending !== pending) {
      return;
    }
    this.settle(pending);
    pending.reject(err);
    if (dropConnection) {
      this.drop(err);
    }
  }

  /** Closes the connection; a request in flight fails with `err`. */
  drop(err) {
    const socket = this.socket;
    this.socket = undefined;
    const pending = this.pending;
    if (pending) {
      this.settle(pending);
      pending.reject(err);
    }
    if (socket) {
      this.waitClosed(socket);
      socket.destroy();
    }
  }
}
