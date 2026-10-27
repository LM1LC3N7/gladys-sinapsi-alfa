// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external ids of the Alfa: `alfa:main`. The Alfa gives no serial number
 * over Modbus: one integration reads ONE Alfa, and its device is that one
 * forever (a new address keeps it and its history; another Alfa behind a new
 * address too: its indexes then pass the guards, see src/guard.js).
 */
export const EXTERNAL_ID_TYPE = 'alfa';
export const PLATFORM_ID = 'main';

// --- Modbus TCP of the Alfa (register map of ha-sinapsi-alfa, MIT) --------------------
/** The Modbus TCP port of the Alfa. */
export const DEFAULT_PORT = 502;
/** The unit id the Alfa answers to (as the reference). */
export const UNIT_ID = 1;
/**
 * The holding registers read, in four requests one after the other on one
 * connection (`[start, count]`): 2-19 (powers and totals of the grid), 203
 * (the tariff band), 780-782 (the cut-off warning), 921-925 (production).
 * The daily registers of the bands (30-65) are not read.
 */
export const BATCHES = [
  [2, 18],
  [203, 1],
  [780, 3],
  [921, 5],
];
/**
 * The batches a read goes on without, when the Alfa refuses them (a Modbus
 * exception): the band, the cut-off warning, the production. The grid
 * batch (2-19) is required.
 */
export const OPTIONAL_BATCHES = [1, 2, 3];

// --- Modbus limits -------------------------------------------------------------------
export const LIMITS = {
  /** A Modbus TCP frame is 260 bytes at most (MBAP 7 + PDU 253). */
  frameBytes: 260,
  /** At most 125 registers in one read (the Modbus limit). */
  registersPerRead: 125,
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const TIMINGS = {
  /** A TCP connection not open after this is "unreachable" (nothing was sent). */
  connectTimeout: 5 * SECOND,
  /** An answer not complete after this: the request failed, the connection is closed. */
  requestTimeout: 5 * SECOND,
  /** A whole read (connection and four requests) never takes longer. */
  readBudget: 20 * SECOND,
  /** A connection closed is waited for at most this long before a new one opens. */
  closeWait: 1 * SECOND,
};

// --- Schedule ------------------------------------------------------------------------
/** One read every 30 s, never faster, whatever asks for it. */
export const POLL_INTERVAL = 30 * SECOND;
/** The indexes are published (and their guards kept in /data) once a minute at most. */
export const INDEX_INTERVAL = MINUTE;
/** An unreachable Alfa or a wrong answer: tries after 30 s, doubled up to 10 minutes. */
export const RETRY_MIN = 30 * SECOND;
export const RETRY_MAX = 10 * MINUTE;
/** The configuration read from Gladys failed: tried again after 5 s, doubled up to 5 min. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay (the manifest gives it 60 s). */
export const TEST_ANSWER_WITHIN = 45 * SECOND;
/** A stop saves /data, then waits for the read running at most this long and saves again. */
export const STOP_WAIT = 5 * SECOND;
/**
 * Every register identical for this long (powers to the watt, indexes to
 * the watt-hour): the Alfa serves a frozen copy, nothing is published until
 * a register moves. Measured on the monotonic clock, kept in /data.
 */
export const FROZEN_AFTER = 30 * MINUTE;
/** "Accept the held index": the second click comes 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;

// --- Plausibility of the lifetime indexes ------------------------------------------
/**
 * The margin of the guards of src/guard.js: no power flows faster than this
 * on average between two published indexes. A configuration field
 * (`max_power_kw`) sets it, within these bounds.
 */
export const INDEX_MAX_KW_DEFAULT = 100;
export const INDEX_MAX_KW_MIN = 1;
export const INDEX_MAX_KW_MAX = 2000;
/** kWh always accepted on top of maxKw x hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/** An index above this (kWh) is not plausible on a feature. */
export const INDEX_MAX = 10_000_000;
/** The highest power a register holds (W): 65535 means "not available". */
export const POWER_MAX = 65_534;
