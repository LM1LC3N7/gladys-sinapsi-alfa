// -----------------------------------------------------------------------------
// The Gladys device of the Alfa and its states. Pure.
//
// External id (forever): alfa:main (src/constants.js). Feature keys
// (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service), as in gladys-p1-monitor and gladys-pure-energie:
// - `import_index` (energy drawn from the grid, lifetime) is the ONLY
//   energy-sensor / index feature: the core derives the consumption and its
//   cost from its deltas;
// - `production_index` (energy produced, lifetime) is the only
//   energy-production-sensor / index: the core derives the production;
// - `export_index` (energy fed to the grid, lifetime) is a grid-sensor /
//   output-index, which the core never counts as consumption nor production;
// - the three pass their own guard of src/guard.js: never 0, a drop or a
//   jump held until the user accepts it;
// - `power` (the power the home uses) is the only energy-sensor / power; the
//   powers drawn and fed are grid-sensor input-power / output-power, the
//   power produced energy-production-sensor / power;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W and kWh; none for unknown (the
//   unit is then in the name).
//
// The features follow what the Alfa showed: the set only grows, and always
// holds the features of the created device, so a device published again
// never loses one (an "Update" in Discovery would drop its history).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, INDEX_MAX, PLATFORM_ID, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  IMPORT_POWER: 'import_power',
  EXPORT_POWER: 'export_power',
  PRODUCTION_POWER: 'production_power',
  IMPORT_INDEX: 'import_index',
  EXPORT_INDEX: 'export_index',
  PRODUCTION_INDEX: 'production_index',
  IMPORT_AVERAGE: 'import_average',
  EXPORT_AVERAGE: 'export_average',
  BAND: 'tariff_band',
  CUTOFF: 'cutoff_warning',
  CUTOFF_LEFT: 'cutoff_seconds_left',
};

/** The lifetime indexes, each behind its guard: feature key -> reading field. */
export const INDEXES = {
  [FEATURE.IMPORT_INDEX]: 'importIndex',
  [FEATURE.EXPORT_INDEX]: 'exportIndex',
  [FEATURE.PRODUCTION_INDEX]: 'productionIndex',
};

/** The live values: feature key -> reading field. */
const LIVE = {
  [FEATURE.POWER]: 'consumptionPower',
  [FEATURE.IMPORT_POWER]: 'importPower',
  [FEATURE.EXPORT_POWER]: 'exportPower',
  [FEATURE.PRODUCTION_POWER]: 'productionPower',
  [FEATURE.IMPORT_AVERAGE]: 'importAverage',
  [FEATURE.EXPORT_AVERAGE]: 'exportAverage',
  [FEATURE.BAND]: 'band',
};

/** Every feature key, in the order of the device. */
export const ORDER = [
  FEATURE.POWER,
  FEATURE.IMPORT_POWER,
  FEATURE.EXPORT_POWER,
  FEATURE.PRODUCTION_POWER,
  FEATURE.IMPORT_INDEX,
  FEATURE.EXPORT_INDEX,
  FEATURE.PRODUCTION_INDEX,
  FEATURE.IMPORT_AVERAGE,
  FEATURE.EXPORT_AVERAGE,
  FEATURE.BAND,
  FEATURE.CUTOFF,
  FEATURE.CUTOFF_LEFT,
];
const KNOWN = new Set(ORDER);

/** The external ids of the Alfa. */
export const ids = (gladys) => gladys.externalIds(EXTERNAL_ID_TYPE, PLATFORM_ID);

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: POWER_MAX,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

const watt = { unit: U.WATT };
const index = { unit: U.KILOWATT_HOUR, max: INDEX_MAX };

/** The definition of each feature key. */
const DEFINITIONS = {
  [FEATURE.POWER]: (e) =>
    feature(e, FEATURE.POWER, 'Home power', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, {
      ...watt,
      max: 2 * POWER_MAX,
    }),
  [FEATURE.IMPORT_POWER]: (e) =>
    feature(e, FEATURE.IMPORT_POWER, 'Power drawn', C.GRID_SENSOR, T.GRID_SENSOR.INPUT_POWER, watt),
  [FEATURE.EXPORT_POWER]: (e) =>
    feature(e, FEATURE.EXPORT_POWER, 'Power fed', C.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_POWER, watt),
  [FEATURE.PRODUCTION_POWER]: (e) =>
    feature(
      e,
      FEATURE.PRODUCTION_POWER,
      'Power produced',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.POWER,
      watt,
    ),
  [FEATURE.IMPORT_INDEX]: (e) =>
    feature(
      e,
      FEATURE.IMPORT_INDEX,
      'Energy drawn (index)',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      index,
    ),
  [FEATURE.EXPORT_INDEX]: (e) =>
    feature(
      e,
      FEATURE.EXPORT_INDEX,
      'Energy fed (index)',
      C.GRID_SENSOR,
      T.GRID_SENSOR.OUTPUT_INDEX,
      index,
    ),
  [FEATURE.PRODUCTION_INDEX]: (e) =>
    feature(
      e,
      FEATURE.PRODUCTION_INDEX,
      'Energy produced (index)',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.INDEX,
      index,
    ),
  [FEATURE.IMPORT_AVERAGE]: (e) =>
    feature(
      e,
      FEATURE.IMPORT_AVERAGE,
      'Power drawn, quarter-hour average (W)',
      C.UNKNOWN,
      T.SENSOR.INTEGER,
    ),
  [FEATURE.EXPORT_AVERAGE]: (e) =>
    feature(
      e,
      FEATURE.EXPORT_AVERAGE,
      'Power fed, quarter-hour average (W)',
      C.UNKNOWN,
      T.SENSOR.INTEGER,
    ),
  [FEATURE.BAND]: (e) =>
    feature(e, FEATURE.BAND, 'Tariff band (1 = F1 ... 6 = F6)', C.UNKNOWN, T.SENSOR.INTEGER, {
      min: 1,
      max: 6,
    }),
  [FEATURE.CUTOFF]: (e) =>
    feature(e, FEATURE.CUTOFF, 'Cut-off warning', C.UNKNOWN, T.SENSOR.BINARY, { max: 1 }),
  [FEATURE.CUTOFF_LEFT]: (e) =>
    feature(e, FEATURE.CUTOFF_LEFT, 'Cut-off in (s)', C.UNKNOWN, T.SENSOR.INTEGER, {
      max: 65534,
    }),
};

/**
 * The device of the Alfa. `keys`: the feature keys to give it (a Set). The
 * features are fixed when the user creates it.
 */
export function buildDevice(gladys, keys, address) {
  const external = ids(gladys);
  return {
    name: 'Sinapsi Alfa',
    external_id: external.device,
    features: ORDER.filter((key) => keys.has(key)).map((key) => DEFINITIONS[key](external)),
    params: [{ name: 'address', value: address }],
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The feature keys a reading shows (a value present). */
export function capabilitiesOf(reading) {
  const keys = new Set();
  for (const [key, field] of [...Object.entries(LIVE), ...Object.entries(INDEXES)]) {
    if (isNumber(reading[field])) keys.add(key);
  }
  if (reading.cutoff) {
    keys.add(FEATURE.CUTOFF);
    if (isNumber(reading.cutoff.left)) keys.add(FEATURE.CUTOFF_LEFT);
  }
  return keys;
}

/** The feature keys a CREATED device carries: never fewer when it is published again. */
export function capabilitiesOfDevice(device) {
  return new Set(
    (device?.features ?? [])
      .map((f) => String(f.external_id).split(':').at(-1))
      .filter((key) => KNOWN.has(key)),
  );
}

/** Keys read back from /data: known keys only. */
export const validKeys = (keys) =>
  new Set(Array.isArray(keys) ? keys.filter((key) => KNOWN.has(key)) : []);

export const union = (...sets) => new Set(sets.flatMap((s) => [...(s ?? [])]));

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const state = (external, key, value, digits = 0) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** The live values of a reading (never an index). */
export function liveStates(external, reading) {
  const states = Object.entries(LIVE).flatMap(([key, field]) =>
    state(external, key, reading[field]),
  );
  if (reading.cutoff) {
    states.push(...state(external, FEATURE.CUTOFF, reading.cutoff.active ? 1 : 0));
    if (reading.cutoff.active) {
      states.push(...state(external, FEATURE.CUTOFF_LEFT, reading.cutoff.left));
    }
  }
  return states;
}

/** An index the guard let through: never 0 (nor below), 3 decimals (the watt-hour). */
export const indexState = (external, key, value) =>
  isNumber(value) && value > 0 ? state(external, key, value, 3) : [];
