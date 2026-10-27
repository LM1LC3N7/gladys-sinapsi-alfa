// -----------------------------------------------------------------------------
// The integration itself: the Sinapsi Alfa read over Modbus TCP, one Gladys
// device, its three lifetime indexes each checked by its guard and published
// once a minute, the freshness of the values, the test and accept buttons.
// index.js (through src/handlers.js) only wires the SDK handlers to it.
// Read-only: the only Modbus function ever sent is "read holding registers".
//
// One read = one connection, the four batches of registers one after the
// other, the connection closed (src/alfa/client.js). The Alfa gives no
// identity over Modbus: its device is the one of this integration, whatever
// the address (src/constants.js).
//
// Starting (the reference's warm-up rule, src/alfa/model.js): a read whose
// import total or tariff band is 0 publishes nothing at all.
//
// Freshness: every register identical for FROZEN_AFTER (kept in /data with
// the time it last changed): the Alfa serves a frozen copy, nothing is
// published until a register moves; the status says so.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container: the
// time of the last read is kept in /data). Structure taken from
// gladys-pure-energie (approved).
//
// A read belongs to its session (the client of one address): when it
// changes, a late answer of the old one publishes nothing and sets no status
// (checked after every await).
//
// Two clocks: `now` (wall clock) dates what /data keeps; `monotonic` paces
// the reads, the retries and the freshness, so that a wall clock set back or
// forward never stops nor hurries them. The index guards get the wall clock
// at start plus the monotonic time since (`guardNow`): a wall clock moved by
// NTP in the session never widens their margin.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { addressText, isComplete, normalizeConfig, sameAddress } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  BATCHES,
  OPTIONAL_BATCHES,
  SILENT_SKIP_READS,
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  FROZEN_AFTER,
  INDEX_INTERVAL,
  INDEX_SLACK_KWH,
  POLL_INTERVAL,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STOP_WAIT,
  TEST_ANSWER_WITHIN,
  TIMINGS,
  UNIT_ID,
} from './constants.js';
import {
  INDEXES,
  buildDevice,
  capabilitiesOf,
  capabilitiesOfDevice,
  ids,
  indexState,
  liveStates,
  round,
  union,
  validKeys,
} from './devices.js';
import { ModbusClient } from './alfa/client.js';
import { parseRegisters } from './alfa/model.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };

/** The time of the last attempt alone is written to /data at most this often (ms). */
const ATTEMPT_SAVE_EVERY = 60_000;
const FINGERPRINT = /^[0-9a-f]{16}$/;
/** A cut-off warning dated more than this before or after now (s) is not one. */
const STALE_CUTOFF_S = 24 * 3600;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The fingerprint of every register read: 16 hex digits. */
export const fingerprintOf = (raw) =>
  createHash('sha256').update(JSON.stringify(raw), 'utf8').digest('hex').slice(0, 16);

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    feature?.last_value !== '' &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/** Plain objects under string keys only (no prototype key). */
function plainEntries(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return [];
  }
  return Object.entries(object).filter(
    ([key, value]) =>
      key !== '__proto__' && value && typeof value === 'object' && !Array.isArray(value),
  );
}

/**
 * The fingerprints of the batches kept in /data, one per batch of BATCHES
 * (`{ fp, at }` or null): `at` the wall time it last changed, brought onto
 * the monotonic clock. A date in the future (a clock behind /data after a
 * restart) keeps the fingerprint: only its age is lost, counted from now.
 */
function keptMarks(marks, now, mono) {
  return BATCHES.map((_, i) => (Array.isArray(marks) ? keptMark(marks[i], now, mono) : undefined));
}

function keptMark(mark, now, mono) {
  if (!mark || typeof mark !== 'object' || !FINGERPRINT.test(String(mark.fp))) {
    return undefined;
  }
  const at = finite(mark.at) && mark.at <= now ? mark.at : now;
  return { fp: mark.fp, at, mono: mono - (now - at) };
}

export class AlfaApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'sinapsi-alfa' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new ModbusClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    /** /data: the guards, the features seen, the freshness, the last read. */
    this.store = store;
    this.savedKey = undefined;
    this.savedAt = undefined;
    this.config = normalizeConfig();
    /** `{ client, discovered }` of the current address; replaced when it changes. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;
    /** The first click of "Accept the held index": `{ at, listedAt, list, session }`, in memory. */
    this.pendingAccept = undefined;
    /** The configuration read from Gladys: retried while it fails (connectedFrom). */
    this.configTimer = undefined;
    this.configTries = 0;
    this.configFailed = false;
    /** The last configuration received (a reconnection whose read fails starts from it). */
    this.lastRaw = undefined;

    const kept = store.load();
    /** /data exists but cannot be read: never written over (what it holds may matter). */
    this.storeUnreadable = kept.unreadable === true;
    const at = now();
    const mono = monotonic();
    /** The feature keys seen, kept so that the device is offered at a restart. */
    this.keys = validKeys(kept.keys);
    /** The fingerprint of the last values and its age. */
    this.marks = keptMarks(kept.marks, at, mono);
    /** The wall clock at start and the monotonic clock then: the time of the index guards. */
    this.wallBase = at;
    this.monoBase = mono;
    // The last read before a restart: the next one never comes sooner than
    // the interval. A date in the future is not valid (no read known).
    this.lastAttemptAt =
      finite(kept.lastAttemptAt) && kept.lastAttemptAt <= at ? kept.lastAttemptAt : undefined;
    /** Monotonic time of the last read started. */
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : mono - (at - this.lastAttemptAt);
    /** By index feature external id. */
    this.guards = new Map();
    this.guardKw = undefined;
    this.resetReads();
  }

  /** What belongs to one address: forgotten when it changes. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'warmup' | 'error', ... }`. */
    this.outcome = undefined;
    /** Wrong answers and unreachable Alfa: retries doubled, in memory. */
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    /** Monotonic time the indexes were last published. */
    this.lastIndexAt = undefined;
    /** Secondary batches left out after a silence: batch index -> reads left. */
    this.skips = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * The 'connected' event: the configuration read from Gladys, again and
   * again while it fails (5 s, doubled up to 5 min), the status saying so.
   * Meanwhile the reads go on with the last configuration received, if any.
   */
  async connectedFrom(readConfig) {
    if (this.configTimer !== undefined) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
    let raw;
    try {
      raw = await readConfig();
    } catch (err) {
      const wait = Math.min(CONFIG_RETRY_MAX, CONFIG_RETRY_MIN * 2 ** this.configTries);
      this.configTries += 1;
      this.configFailed = true;
      this.logger.warn(
        `sinapsi-alfa: the configuration could not be read (${err?.name ?? 'Error'}); next try in ${Math.round(wait / 1000)} s`,
      );
      if (this.lastRaw !== undefined) {
        await this.start(this.lastRaw, { fromGladys: false });
      } else {
        await this.serialize(async () => {
          this.lastStatus = undefined;
          await this.setStatus(false, T.configFailed(wait));
        });
      }
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        this.connectedFrom(readConfig).catch((e) =>
          this.logger.error(`sinapsi-alfa: start failed (${e?.name ?? 'Error'})`),
        );
      }, wait);
      return;
    }
    this.configTries = 0;
    await this.start(raw && typeof raw === 'object' ? raw : {});
  }

  /** A configuration from Gladys (`fromGladys`), or the last one again. */
  start(raw = {}, { fromGladys = true } = {}) {
    if (fromGladys) {
      this.lastRaw = raw;
      this.configFailed = false;
      this.configTries = 0;
      if (this.configTimer !== undefined) {
        this.timers.clearTimeout(this.configTimer);
        this.configTimer = undefined;
      }
    }
    return this.serialize(() => this.doStart(raw));
  }

  /**
   * Stops the reads, waits (bounded) for the one running, and writes /data:
   * the time of the last read and what was seen since the last save are
   * never lost by a clean stop.
   */
  stop() {
    if (this.configTimer !== undefined) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = undefined;
    }
    return this.serialize(async () => {
      this.doStop();
      // The Alfa serves one client: a stop closes the connection of a read
      // running (its answer is dropped, as for another address); the next
      // start opens a new session.
      this.session?.client?.close();
      this.session = undefined;
      // Written first: Docker stops the container 10 s after asking.
      await this.saveState(true);
      if (this.busy) {
        let timer;
        await Promise.race([
          this.busy.catch(() => {}),
          new Promise((resolve) => {
            timer = this.timers.setTimeout(resolve, STOP_WAIT);
          }),
        ]);
        this.timers.clearTimeout(timer);
      }
      await this.saveState();
    });
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first ||
      !sameAddress(config.address, this.config.address) ||
      config.invalidAddress !== this.config.invalidAddress;
    this.config = config;
    if (this.guardKw !== config.maxKw) {
      // Another margin: the guards are built again from /data (saved first).
      await this.saveState();
      this.guards.clear();
      this.guardKw = config.maxKw;
    }
    if (changed) {
      this.session?.client?.close();
      this.session = {
        client: isComplete(config)
          ? this.clientFactory({
              host: config.address.host,
              port: config.address.port,
              unitId: UNIT_ID,
              timers: this.timers,
              monotonic: this.monotonic,
            })
          : undefined,
        discovered: false,
      };
      // A list of the first click belongs to its session.
      this.pendingAccept = undefined;
      if (!first) {
        this.resetReads();
      }
    }
    this.running = true;
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read that brings new ones).
    this.lastStatus = undefined;
    this.lastIndexAt = undefined;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.updateStatus();
      return;
    }
    await this.discover();
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // --- Pace ------------------------------------------------------------------

  /** The monotonic time from which the next read may start, from the caller's instant `mono` (the clock is read once per decision). */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + POLL_INTERVAL;
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, this.nextTryAt);
    }
    return due;
  }

  /** One timer: the next read when it is due. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client) {
      return;
    }
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`sinapsi-alfa: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick() {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read() {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      return;
    }
    /** Another address (or a stop) during an await: this read gives up, silently. */
    const gone = () => session !== this.session || !this.running;
    this.lastReadAt = mono;
    // Written BEFORE every request (forced: twice a minute): a restart or a
    // crash during it never reads again sooner than the interval.
    this.lastAttemptAt = this.now();
    await this.saveState(true);
    if (gone()) return;
    let reading;
    try {
      reading = await this.readAll(client, mono);
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono, gone);
      return;
    }
    if (gone()) return;
    await this.succeeded(reading, mono, gone);
  }

  /** The registers of the Alfa, one connection, its deadline from the start of the read. */
  async readAll(client, mono) {
    // A secondary batch that did not answer is left out for a few reads
    // (the others are read meanwhile), then tried again.
    const skip = [];
    for (const [index, left] of this.skips) {
      if (left > 0) {
        skip.push(index);
        this.skips.set(index, left - 1);
      } else {
        this.skips.delete(index);
      }
    }
    const missed = new Map();
    const words = await client.read(BATCHES, {
      by: mono + TIMINGS.readBudget,
      optional: OPTIONAL_BATCHES,
      skip,
      missed,
    });
    for (const [index, why] of missed) {
      if (why === 'silent') this.skips.set(index, SILENT_SKIP_READS);
    }
    const reading = parseRegisters(words);
    // A cut-off more than a day away from now is not an alarm: in the past,
    // an old warning left in the registers (review r1 m3); in the future, a
    // false one (review r2 m1: the time is the one of the warning, about now,
    // plus at most 65534 s). The wall clock decides this rule: it is the only
    // clock that compares with the meter's date.
    const cut = reading.cutoff;
    const nowS = this.now() / 1000;
    if (cut?.active && Math.abs(cut.at - nowS) > STALE_CUTOFF_S) {
      reading.cutoff = { active: false, at: undefined, left: undefined, stale: cut.at };
    }
    reading.missed = [...missed].map(([index, why]) => ({ start: BATCHES[index][0], why }));
    return reading;
  }

  // --- Outcomes ----------------------------------------------------------------

  async succeeded(reading, mono, gone) {
    // An answer: the retries are over.
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    if (reading.warmup) {
      // Still starting: its registers read 0. Nothing of this read is published
      // nor counted for the freshness.
      this.outcome = { at: mono, kind: 'warmup' };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    let grew = !this.session.discovered;
    const keys = union(
      this.keys,
      capabilitiesOfDevice(this.createdDevice()),
      capabilitiesOf(reading),
    );
    if (keys.size !== this.keys.size) {
      grew = true;
    }
    this.keys = keys;
    this.followFreshness(reading, mono);
    this.outcome = { at: mono, kind: 'reading', reading };
    if (grew) {
      this.session.discovered = true;
      await this.discover();
      if (gone()) return;
    }
    if (!reading.frozen) {
      await this.publish(reading, mono, gone);
      if (gone()) return;
    }
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  /**
   * The fingerprint of each batch read, kept in /data with the wall time it
   * last changed: when no batch has changed for FROZEN_AFTER, the values are
   * frozen. A batch not read this time keeps its mark (a secondary batch
   * missing never makes the values look new). After a restart, the same
   * fingerprints keep their age.
   */
  followFreshness(reading, mono) {
    let changed = false;
    reading.raw.forEach((batch, i) => {
      if (!batch) return;
      const fp = fingerprintOf(batch);
      if (this.marks[i]?.fp !== fp) {
        this.marks[i] = { fp, at: this.now(), mono };
        changed = true;
      }
    });
    const latest = Math.max(...this.marks.filter(Boolean).map((m) => m.mono));
    reading.frozen = !changed && mono - latest >= FROZEN_AFTER;
  }

  /** The time given to the index guards: the wall clock at start plus the monotonic time since. */
  guardNow(mono = this.monotonic()) {
    return this.wallBase + (mono - this.monoBase);
  }

  async failed(err, mono, gone) {
    // The next try counts from the failure, not from the start of the read.
    const at = this.monotonic();
    // Our own words only (ModbusError kinds): never a text of the device.
    this.logger.warn(
      `sinapsi-alfa read failed: ${err?.kind ?? 'error'}${Number.isInteger(err?.code) ? ` ${err.code}` : ''}`,
    );
    this.outcome = { at: mono, kind: 'error', err };
    // Retries doubled (never faster than the interval).
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.lastError = err;
    this.nextTryAt = at + wait;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = addressText(this.config.address);
    const general = [];
    if (this.configFailed) general.push(T.notes.configFailed);
    if (this.storeUnreadable) general.push(T.notes.storeUnreadable);
    if (!this.session?.client) {
      return [
        false,
        T.withNotes(this.config.invalidAddress ? T.badAddress : T.incomplete, general),
      ];
    }
    const mono = this.monotonic();
    const notes = [...this.heldNotes(), ...general];
    if (this.lastError && this.failures > 0) {
      const wait = Math.max(0, (this.nextTryAt ?? 0) - mono);
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.outcome?.kind === 'warmup') {
      return [false, T.warmup(address, notes)];
    }
    if (this.outcome?.kind === 'reading') {
      const { reading } = this.outcome;
      const extra = [];
      if (!this.createdDevice()) extra.push(T.notes.noDevice);
      if (reading.frozen) extra.push(T.notes.frozen(FROZEN_AFTER));
      if (reading.importIndex === undefined) extra.push(T.notes.noImport);
      if (reading.noProductionData) extra.push(T.notes.noProductionData);
      if (reading.productionBelowExport) extra.push(T.notes.productionBelowExport);
      if (reading.bandUnknown) extra.push(T.notes.bandUnknown);
      if (reading.missed?.length > 0) extra.push(T.notes.missed(reading.missed));
      if (reading.cutoff?.stale !== undefined) {
        extra.push(T.notes.cutoffStale(reading.cutoff.stale, this.now() / 1000));
      }
      if (reading.cutoff?.active) {
        // The wall clock only words the note (past or to come), it decides nothing.
        extra.push(T.notes.cutoff(reading.cutoff, this.now() / 1000));
      }
      return [true, T.ok(address, [...extra, ...notes])];
    }
    return [false, T.waiting(address, notes)];
  }

  /** The indexes held back, `[{ id, key, direction, from, to, threshold }]`. */
  heldList() {
    const created = this.createdDevice();
    if (!created) {
      return [];
    }
    const external = ids(this.gladys);
    const list = [];
    for (const key of Object.keys(INDEXES)) {
      const id = external.feature(key);
      if (!this.hasFeature(created, id)) continue;
      const held = this.guardOf(created, id).held;
      if (held) {
        list.push({
          id,
          key,
          direction: held.direction,
          from: held.from,
          to: held.to,
          threshold: held.threshold,
        });
      }
    }
    return list;
  }

  /** The indexes held back, for every status (the user must see them while waiting). */
  heldNotes() {
    return this.heldList().map((held) => T.notes.held(held));
  }

  // --- /data -------------------------------------------------------------------------

  /** Keeps the features seen, the freshness, the last read and the guards. */
  async saveState(force = false) {
    // A file that cannot be read (at start or since) is never written over:
    // written again only once it reads back (fixed or removed by the user).
    const loaded = this.store.load();
    if (loaded.unreadable === true) {
      if (!this.storeUnreadable) {
        this.storeUnreadable = true;
        this.logger.warn('sinapsi-alfa: the state file in /data cannot be read, left as it is');
      }
      return;
    }
    if (this.storeUnreadable) {
      this.storeUnreadable = false;
      this.savedKey = undefined;
    }
    const indexes = {};
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    // Never overwrite an index state not loaded yet: merged with /data.
    const kept = Object.fromEntries(plainEntries(loaded.indexes));
    for (const id of Object.keys(indexes)) delete kept[id];
    const state = {
      keys: [...this.keys],
      marks: this.marks.map((m) => (m ? { fp: m.fp, at: m.at } : null)),
      lastAttemptAt: this.lastAttemptAt ?? null,
      indexes: Object.fromEntries(Object.entries({ ...kept, ...indexes }).slice(-8)),
    };
    // Written only when the content changes: the time of the attempt alone
    // (it moves at every read) is written at most once a minute (SD cards).
    const key = JSON.stringify({ ...state, lastAttemptAt: null });
    const mono = this.monotonic();
    if (
      !force &&
      key === this.savedKey &&
      this.savedAt !== undefined &&
      mono - this.savedAt < ATTEMPT_SAVE_EVERY
    ) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      this.savedAt = mono;
    } catch (err) {
      this.logger.warn(`Saving the sinapsi-alfa state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /** The created Gladys device of the Alfa, undefined until the user creates it. */
  createdDevice() {
    const externalId = ids(this.gladys).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  /** Whether a created device carries a feature (a device without its list: all). */
  hasFeature(created, featureId) {
    return !created.features || created.features.some((f) => f.external_id === featureId);
  }

  async discover() {
    if (!this.session?.client) {
      return;
    }
    const keys = union(this.keys, capabilitiesOfDevice(this.createdDevice()));
    if (keys.size === 0) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([buildDevice(this.gladys, keys, addressText(this.config.address))])
      .catch((err) => this.logger.warn(`Publishing the sinapsi-alfa device failed (${err?.name})`));
  }

  /** The Discover tab asks: the known device, never a read (the next one comes at its time). */
  async scan() {
    await this.discover();
  }

  async onDeviceCreated(device) {
    // Recognized by its external id: a new device has no reference of its
    // indexes yet (nor a state kept for a deleted device).
    if (device?.external_id !== ids(this.gladys).device) {
      return;
    }
    const external = ids(this.gladys);
    const indexIds = Object.keys(INDEXES).map((key) => external.feature(key));
    for (const id of indexIds) this.guards.delete(id);
    this.pendingAccept = undefined;
    const kept = this.store.load();
    if (kept.unreadable !== true) {
      const indexes = Object.fromEntries(plainEntries(kept.indexes));
      for (const id of indexIds) delete indexes[id];
      await this.store
        .save({ ...kept, indexes })
        .catch((err) =>
          this.logger.warn(
            `Clearing the sinapsi-alfa index states failed (${err?.code ?? 'error'})`,
          ),
        );
    }
    this.savedKey = undefined;
    await this.saveState();
    // Its values at the next read bringing new ones (never an old one now).
    this.lastIndexAt = undefined;
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    if (device?.external_id === ids(this.gladys).device) {
      // New features (Update in Discovery): their indexes at the next read.
      this.lastIndexAt = undefined;
      await this.updateStatus();
    }
  }

  // --- Values ------------------------------------------------------------------------

  /** The guard of an index of the created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = Object.fromEntries(plainEntries(this.store.load().indexes))[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved, this.guardNow(), {
          maxKw: this.config.maxKw,
          slackKwh: INDEX_SLACK_KWH,
        }),
      );
    }
    return this.guards.get(id);
  }

  /** The states of a new reading: the live values every time, the indexes once a minute. */
  async publish(reading, mono, gone) {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    if (this.lastIndexAt !== undefined && mono < this.lastIndexAt) {
      this.lastIndexAt = undefined;
    }
    const indexDue = this.lastIndexAt === undefined || mono - this.lastIndexAt >= INDEX_INTERVAL;
    const external = ids(this.gladys);
    const states = liveStates(external, reading);
    reading.published = {};
    if (indexDue) {
      this.lastIndexAt = mono;
      const at = this.guardNow(mono);
      for (const [key, field] of Object.entries(INDEXES)) {
        const id = external.feature(key);
        if (!this.hasFeature(created, id)) continue;
        const guard = this.guardOf(created, id);
        const value = finite(reading[field]) ? round(reading[field], 3) : undefined;
        const plausible = value !== undefined && guard.accept(value, at);
        if (value !== undefined && !plausible && guard.held) {
          this.logger.warn(
            `sinapsi-alfa ${key} ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
          );
        }
        // While a value is held, the last accepted one is sent again (no delta for the core).
        const sent = plausible ? value : guard.held ? guard.last?.value : undefined;
        reading.published[key] = sent;
        states.push(...indexState(external, key, sent));
      }
      // The guards are in /data BEFORE Gladys gets the values: a crash in
      // between never sends an index /data does not know.
      await this.saveState();
      if (gone()) return;
    }
    // Only the features the created device has (they are fixed at its creation).
    const allowed = states.filter((s) => this.hasFeature(created, s.device_feature_external_id));
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the sinapsi-alfa values failed (${err?.name})`));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks (as gladys-iskra, approved): the
   * first lists every index held and accepts nothing; the second, 3 s to
   * 5 min later in the same session, accepts exactly what the first listed,
   * each only when its held value still shows the same jump or drop (the
   * same direction and starting value, the value shown or what may have
   * flowed since, src/guard.js). An index held after the first click is
   * never taken. A save of the form never accepts.
   */
  async acceptHeldIndex() {
    const list = this.heldList();
    const mono = this.monotonic();
    // Session time (never the wall clock moved by NTP meanwhile).
    const now = this.guardNow(mono);
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (
      !pending ||
      pending.session !== this.session ||
      elapsed > ACCEPT_CONFIRM_WITHIN ||
      elapsed < ACCEPT_CONFIRM_AFTER
    ) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list, session: this.session };
      // The most an index may add between the clicks: maxKw over the window, plus the slack.
      const margin = (this.config.maxKw * ACCEPT_CONFIRM_WITHIN) / 3_600_000 + INDEX_SLACK_KWH;
      return T.accept.confirm(list, ACCEPT_CONFIRM_WITHIN, margin);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.id);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        (entry.direction === 'up'
          ? held.threshold === entry.threshold &&
            held.to >= entry.to &&
            held.to - entry.to <= margin
          : Math.abs(held.to - entry.to) <= margin);
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
        this.logger.info(
          `sinapsi-alfa ${entry.key} ${entry.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
        );
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    // Published at the next new reading (never a read sooner than the interval).
    this.lastIndexAt = undefined;
    await this.saveState();
    return T.accept.done(accepted, changed);
  }

  /**
   * The test button: never a read sooner than the pace allows. When a read
   * is due, this click makes it; otherwise it tells the last one.
   */
  async testConnection() {
    if (!this.session?.client) {
      return this.currentStatus()[1];
    }
    const mono = this.monotonic();
    if (this.busy || this.dueAt(mono) > mono) {
      return this.describeOutcome(undefined, mono);
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.tick().then(() => this.describeOutcome(mono)), late]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  /**
   * The last read in words, and the time to the next one. `since`: when this
   * click started a read; a read from then on is told as "read now". An index
   * shown is the one sent to Gladys, or the value held back, said so.
   */
  describeOutcome(since, mono = this.monotonic()) {
    const next = Math.max(0, this.dueAt(mono) - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return T.test.notYet(next, POLL_INTERVAL);
    }
    const ago =
      since !== undefined && outcome.at >= since ? undefined : Math.max(0, mono - outcome.at);
    const address = addressText(this.config.address);
    if (outcome.kind === 'warmup') {
      return T.test.warmup(address, ago, next);
    }
    if (outcome.kind === 'reading') {
      const { reading } = outcome;
      const held = new Map(this.heldList().map((h) => [h.key, h]));
      const indexes = Object.fromEntries(
        Object.entries(INDEXES).map(([key, field]) => {
          const h = held.get(key);
          return [
            key,
            h ? { value: h.to, held: true } : { value: reading.published?.[key] ?? reading[field] },
          ];
        }),
      );
      return T.test.reading(address, reading, indexes, ago, next);
    }
    return T.test.failed(address, outcome.err, ago, next);
  }
}
