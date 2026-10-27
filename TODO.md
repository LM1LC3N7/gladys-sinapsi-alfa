# TODO

## Before announcing

- [x] Review r3 (2026-10-27): APPROUVÉ, no blocker.
- [ ] Next patch — review r3 leftover: the 24 h rule on the cut-off notice
      depends on the wall clock more than said here: a real notice due in
      18 h is published as "false" if the container clock is ~6 h late, and
      as "old" if it is 2 days ahead. Bound the future at about 7 days and
      word the note without claiming the notice is false.
- [ ] Test on a real Gladys with a real Sinapsi Alfa: test button, device
      creation, the consumption and production the core derives from the
      indexes, the warm-up after a restart of the Alfa.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real device (built without one)

- [ ] The register map on the current firmware: no Sinapsi document for it
      was found (web search 2026-10-27); the addresses are those of
      ha-sinapsi-alfa 1.13.11 (its `const.py` and the "Alfa Modbus Register
      Map" of its docs), the same in node-red-contrib-alfasinapsi-ultimate
      (MIT, checked only, nothing taken). Ask Sinapsi or an owner for the
      current map.
- [ ] Whether the Alfa accepts a new connection every 30 s (the reference
      also opens and closes one per poll, 60 s by default).
- [ ] The unit and epoch of 780-782 (Unix seconds and seconds left, as the
      reference shows them) and how long the warning lasts.
- [ ] Whether 65535 / 0xFFFFFFFF ever appear on powers and totals (taken as
      "not available" here, as the reference does for 782 and 780).
- [ ] Whether a production total of 0 with an export total above 0 is the
      usual state of an Alfa without production data (the reference's
      validity rule).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-sinapsi-alfa:0.1.0`);
  the Release workflow owns them from now on.
- **SDK `^0.16.0`**, the latest on npm (2026-10-27).
- **Manifest**: `gladys_version` `>=5.1.0`; category `energy`; no `keywords`
  nor `countries` yet (Italy only: `countries: ["IT"]` and keywords
  "Sinapsi", "Chain 2", "contatore" once Gladys 5.3 is widespread).
- **Reused project**: ha-sinapsi-alfa (Alessandro Del Prete, MIT, 1.13.11,
  `main` at 5d88f99), cloned read-only in `~/code/ref/lot17/ha-sinapsi-alfa`:
  its register map, batches, warm-up rule, production validity rule and home
  power are ported (`src/alfa/model.js`). Its Modbus library (ModbusLink,
  Python) is not: the client is our own (`src/alfa/client.js`), cut down from
  gladys-stiebel-eltron / gladys-ctc (approved) to the read of holding
  registers, about 300 lines, no dependency: the SDK stays the only runtime
  dependency. A GPL Homey app for the Alfa was looked at for the addresses
  only and removed; nothing taken from it.
- **Read-only**: only Modbus function 3; the client has no write function; no
  `onSetValue`.
- **One connection per read** (as the reference): the Alfa serves a single
  Modbus client; the four batches one after the other, never two requests on
  the wire; the connection closed after the read, the next one only once it
  is closed (or after 1 s). A timeout (5 s per request) drops the connection.
  The whole read has a 20 s deadline.
- **Identity**: the Alfa gives no serial over Modbus (the reference reads the
  MAC address through ARP, not available from a Docker container): one Alfa
  per integration, external id `alfa:main`, kept whatever the address. Another
  Alfa behind the address: its totals pass the guards (held until accepted,
  unless within the margin: maxKw x time since the last value).
- **Guard margin**: 30 kW by default (review r1 m2), above any Italian home
  contract (3 to 6 kW, up to 15 kW three-phase); 1 to 2000 kW in the form.
- **Energy**: `import_index` the only `energy-sensor/index`,
  `production_index` the only `energy-production-sensor/index`,
  `export_index` a `grid-sensor/output-index` (the core counts neither as
  consumption nor production). Each behind its `IndexGuard` (the approved
  shared file of gladys-iskra, with its tests), 3 decimals, once a minute,
  the guards in `/data` before Gladys gets the values; accepted in two clicks
  (3 s to 5 min apart, same session, bounded to the value shown plus the
  margin), as gladys-iskra for several indexes. No `publishEnergyConsumption`.
  The home power (`energy-sensor/power`) is drawn + max(0, produced - fed),
  or drawn alone for a home that never fed the grid.
- **Not a measurement**: the whole read dropped while the Alfa starts (import
  total or band at 0, the reference's rule; band not read: the import total
  alone, said in the status); 65535 W and any total whose high word is 0xFFFF
  are "not available" (also a bound on a first value, review r1 m6); export
  values only once the export total is above 0; the band only 1..6; the
  cut-off seconds only while a warning is on and when not 65535.
- **Production** (review r1 I2): published whenever its total is above 0, as
  the reference (its gate only blocks derived energies). Below the export
  total (a production meter replaced, meters of other classes): still sent,
  status note. No production total while exported: no production data, no
  home power.
- **Cut-off warning** (review r1 I1, m3): "none" for 0 and any time whose
  high word is 0xFFFF (0xFFFFFFFE included, node-red-contrib-alfasinapsi-ultimate
  1.1.6). A time already past (less than a day) is told "already past". More
  than a day away from the wall clock, either way (review r2 m1), it is not a
  warning: 0 and a status note (the cut time is the time of the warning,
  about now, plus at most 65534 s). The wall clock decides this rule, the
  only clock that compares with the meter's date; a container clock off by
  more than a day would hide a real warning.
- **Secondary batches** (review r1 I3): band, cut-off and production never
  block the grid batch: a refusal (exception) keeps the connection; no answer
  within 5 s (as the grid batch and the reference) drops it, the batches after it wait for the next read, and the
  silent one is left out for 4 reads, then tried again. Status: which batch
  and why.
- **Not read**: the daily totals per band of the day before (30-65): they
  would be `daily-consumption`, which only `publishEnergyConsumption` may
  feed; the energies derived from production (the reference's 15-min skew
  between production and export would need its sync guard).
- **Freshness**: a fingerprint of every register read, kept in `/data` with
  the wall time it last changed; unchanged for 30 min (the totals move every
  15 min on the Alfa, per the reference): frozen, nothing published, status
  note. A future date in `/data` keeps the fingerprint and restarts its age.
- **Pace**: one timer, one read at a time, never two reads less than 30 s
  apart whatever asks; the time of the last read written to `/data` before
  every request (twice a minute, review r1 m1: a crash never reads sooner); a
  future date there is not valid. Retries 30 s doubled to 10 min. No pause machinery
  (no 429/5xx in Modbus).
- **Configuration read again** (lot 17 lesson): `getConfig()` in `connected`
  is retried without end, 5 s doubled to 5 min, with a status; meanwhile the
  reads go on with the last configuration received (none at the first
  start: the status says so).
- **Addresses**: IPv4 in its plain dotted form or a host name, port 502 by
  default; 0.0.0.0, x.x.x.255, multicast, other IPv4 forms, IPv6, logins and
  control bytes refused; what was typed is never shown back.
- **Index guard time**: the wall clock at start plus the monotonic time
  since (as gladys-pure-energie).
- **/data**: a missing file is an empty state; a file that cannot be read, at
  start or later (checked at every save), is never written over (status
  note).
- **Test kit**: `test/kit/` holds the parts of `~/code/ref/gladys-testkit`
  the tests use (same author, Apache-2.0), so the GitHub CI runs them.

## Ideas

- The daily totals per band (30-65), once a way to publish them as
  `daily-consumption` through `publishEnergyConsumption` is settled.
- A scene event at the start of a cut-off warning.
