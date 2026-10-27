// -----------------------------------------------------------------------------
// The registers of the Alfa -> values. Pure.
//
// Register map: ha-sinapsi-alfa (Alessandro Del Prete, MIT, see
// THIRD_PARTY_NOTICES.md), its `const.py` and the "Alfa Modbus Register Map"
// of its docs; the same addresses in node-red-contrib-alfasinapsi-ultimate
// (MIT). Holding registers, big-endian words, a 32-bit value high word first:
//
//   2      uint16  active power drawn from the grid, now (W)
//   5-6    uint32  active energy drawn from the grid, lifetime (Wh)
//   9      uint16  active power drawn, average of the quarter hour (W)
//   12     uint16  active power fed to the grid, now (W)
//   15-16  uint32  active energy fed to the grid, lifetime (Wh)
//   19     uint16  active power fed, average of the quarter hour (W)
//   203    uint16  current tariff band, 1 to 6 (F1 to F6); 0 while starting
//   780-781 uint32 time of the cut-off warning (Unix s); 0xFFFFFFFF: none
//   782    uint16  seconds left before the cut-off; 65535: not given
//   921    uint16  active power produced, now (W)
//   924-925 uint32 active energy produced, lifetime (Wh)
//
// What is not a measurement is never one here (undefined, never 0):
// - a 16-bit power at 65535, a 32-bit total whose high word is 0xFFFF
//   (0xFFFFFFFF and the like): not available;
// - a lifetime total at 0: never published (the guard says so too);
// - the device starting (the reference's warm-up rule): the import total at
//   0 or the band at 0 (its registers are not filled yet). Then the whole
//   reading is `warmup` and nothing of it is published (band not read: the
//   import total alone, `bandUnread`);
// - production: its values only when its total is above 0. Below the energy
//   fed (a production meter replaced, two meters of other classes), they are
//   still published, as the reference does, and the status says so. No
//   production total while the home fed the grid: no home power;
// - export: its values only once its lifetime total is above 0 (a home that
//   never fed the grid has no export features);
// - the cut-off warning: a band, a time, seconds, all checked; the band
//   outside 1..6 is not published.
// -----------------------------------------------------------------------------

import { BATCHES } from '../constants.js';

const NA16 = 0xffff;
/** 0xFFFF0000: a 32-bit value whose high word is the 16-bit sentinel. */
const NA32_HIGH = 0xffff0000;

/** The word at a register address, from the batches read (BATCHES order). */
function wordAt(words, address) {
  for (const [i, [start, count]] of BATCHES.entries()) {
    if (address >= start && address < start + count) {
      const value = words[i]?.[address - start];
      return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : undefined;
    }
  }
  return undefined;
}

const u16 = (words, address) => wordAt(words, address);

function u32(words, address) {
  const high = wordAt(words, address);
  const low = wordAt(words, address + 1);
  return high === undefined || low === undefined ? undefined : high * 0x10000 + low;
}

/** A power in W, or undefined (65535: not available). */
const power = (raw) => (raw === undefined || raw === NA16 ? undefined : raw);
/**
 * A lifetime total in Wh, or undefined: 0xFFFFFFFF is "not available", and
 * a high word at 0xFFFF (4294901 kWh and above) is a sentinel, never a total.
 */
const total = (raw) => (raw === undefined || raw >= NA32_HIGH ? undefined : raw);
const kwh = (wh) => (wh === undefined || wh <= 0 ? undefined : wh / 1000);

/**
 * The values of one read. `words`: the words of each batch of BATCHES, a
 * batch not read being undefined. Every value in W or kWh, or undefined
 * when it is not a measurement.
 */
export function parseRegisters(words) {
  const importWh = total(u32(words, 5));
  const exportWh = total(u32(words, 15));
  const productionWh = total(u32(words, 924));
  const bandRaw = u16(words, 203);
  const productionRead = Array.isArray(words[BATCHES.findIndex(([start]) => start === 921)]);
  const reading = {
    /** The raw words, for the freshness of the values (src/app.js). */
    raw: words.map((batch) => (Array.isArray(batch) ? [...batch] : null)),
    // The reference's two signals; without the band, the import total alone
    // (the status says so: `bandUnread`).
    warmup: importWh === 0 || bandRaw === 0,
    bandUnread: bandRaw === undefined,
    importPower: power(u16(words, 2)),
    importAverage: power(u16(words, 9)),
    importIndex: kwh(importWh),
    exportPower: undefined,
    exportAverage: undefined,
    exportIndex: undefined,
    productionPower: undefined,
    productionIndex: undefined,
    /** Fed to the grid, production read, but no production total: no production data. */
    noProductionData: false,
    /** The production total below the energy fed (a production meter replaced...): a note only. */
    productionBelowExport: false,
    consumptionPower: undefined,
    band: Number.isInteger(bandRaw) && bandRaw >= 1 && bandRaw <= 6 ? bandRaw : undefined,
    bandUnknown: bandRaw !== undefined && bandRaw > 6,
    cutoff: cutoffOf(u32(words, 780), u16(words, 782)),
    /** The batches not read (their first register address). */
    unread: BATCHES.filter((_, i) => !Array.isArray(words[i])).map(([start]) => start),
  };
  const exported = exportWh !== undefined && exportWh > 0;
  if (exported) {
    reading.exportPower = power(u16(words, 12));
    reading.exportAverage = power(u16(words, 19));
    reading.exportIndex = kwh(exportWh);
  }
  // As the reference: the production is published whenever its total is
  // read and above 0; production below export only blocks derived values
  // here (none are computed) and is told in the status.
  const productionValid = productionWh !== undefined && productionWh > 0;
  if (productionValid) {
    reading.productionPower = power(u16(words, 921));
    reading.productionIndex = kwh(productionWh);
    reading.productionBelowExport = exported && productionWh < exportWh;
  }
  reading.noProductionData = productionRead && !productionValid && exported;
  reading.consumptionPower = consumptionOf(reading, productionValid, exported);
  return reading;
}

/**
 * The power the home uses: drawn + max(0, produced - fed), from the powers
 * of this read. Without production data, only when the home never fed the
 * grid (no production at all: drawn alone).
 */
function consumptionOf(reading, productionValid, exported) {
  if (reading.importPower === undefined) {
    return undefined;
  }
  if (productionValid) {
    if (reading.productionPower === undefined) return undefined;
    const fed = exported ? reading.exportPower : 0;
    if (fed === undefined) return undefined;
    return reading.importPower + Math.max(0, reading.productionPower - fed);
  }
  return exported ? undefined : reading.importPower;
}

/**
 * The cut-off warning (avviso distacco): `{ active, at, left }`. Active when
 * the time is given: never 0, nor 0xFFFFFFFE / 0xFFFFFFFF (some meters give
 * the first for "none", node-red-contrib-alfasinapsi-ultimate 1.1.6), nor any
 * time whose high word is 0xFFFF (a sentinel); `left` the seconds before the
 * cut-off when given (not 65535); `at` the time of the cut-off (Unix s): the
 * time of the warning plus the seconds left, as the reference shows it.
 * Undefined when the registers were not read.
 */
function cutoffOf(time, left) {
  if (time === undefined || left === undefined) {
    return undefined;
  }
  if (time === 0 || time >= NA32_HIGH) {
    return { active: false, at: undefined, left: undefined };
  }
  const seconds = left === NA16 ? undefined : left;
  return { active: true, at: time + (seconds ?? 0), left: seconds };
}
