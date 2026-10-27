# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the **Sinapsi Alfa** (the reader of the Italian 2G electricity
meters, Chain 2) through its local **Modbus TCP** server (port 502, unit id 1,
holding registers). The register map is ported from
[ha-sinapsi-alfa](https://github.com/alexdelprete/ha-sinapsi-alfa) (MIT, see
`THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with Sinapsi.
**Read-only**: never `onSetValue`, only Modbus function 3. Siblings:
`gladys-pure-energie` (the structure of `src/app.js`, the store, the pace),
`gladys-iskra` / `gladys-p1-monitor` (the guard), `gladys-ctc` /
`gladys-stiebel-eltron` (the Modbus client, the configuration read again).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing. `test/client.test.js` and `test/realclock.test.js` use the local TCP
servers of `test/kit/` (copied from `~/code/ref/gladys-testkit`).

## Architecture

```
index.js                          SDK wiring only (src/handlers.js), before connect()
src/handlers.js                   the handlers, shared with the tests
src/app.js                        AlfaApp: the pace, the indexes, freshness, buttons, getConfig retried
src/alfa/client.js                the only Modbus access (read holding registers, one connection per read)
src/alfa/model.js                 the registers -> values (pure)
src/guard.js                      plausibility of an energy index (approved shared file, pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     the address, the margin, normalized
src/constants.js                  registers, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, the SDK's fake Gladys, a fake Alfa, a virtual clock
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read-only**: the client has no write function and sends only function 3.
  Never add one.
- **Energy monitoring**: `import_index` (`energy-sensor` / `index`) is the
  only consumption index, `production_index` (`energy-production-sensor` /
  `index`) the only production index, `export_index` a `grid-sensor` /
  `output-index` (never counted). Each passes its own `IndexGuard`
  (`src/guard.js`, `max_power_kw`, 0.5 kWh): never 0, a drop and a jump never
  confirmed by repetition nor by time, taken only by `accept_held_index` in
  two clicks. Never `publishEnergyConsumption`. Do not change `src/guard.js`
  without the same change in its siblings and a review.
- **Not a measurement is never one**: 65535 W, 0xFFFFFFFF Wh, a total at 0,
  a band outside 1..6, the Alfa starting (import total or band at 0: the whole
  read is dropped), production below export: undefined, never 0.
- **Units**: only the core's (`DEVICE_FEATURE_UNITS_BY_CATEGORY`): W and kWh,
  none for `unknown` (the unit is in the name).
- **Modbus**: one connection per read, closed after it, a new one only once
  the old is closed; one request at a time; every answer checked
  (transaction, protocol, unit, function, byte count); a timeout drops the
  connection. The Alfa serves a single client.
- **Freshness**: every register unchanged for 30 min = frozen, nothing
  published; the fingerprint and its age are in `/data`.
- **The pace**: never two reads less than 30 s apart, whatever asks; the time
  of the last read is in `/data`. Never add a read path that skips
  `dueAt(mono)`; read the clock once per decision; decisions on the monotonic
  clock only.
- **Configuration**: `getConfig()` in `connected` is retried without end (5 s
  doubled to 5 min), the reads going on with the last configuration received.
- **Late answers**: every await in a read is followed by `gone()`; an old
  session (address) never publishes nor sets a status.
- **Never a free text of the device nor what the user typed in a message.**
- **External ids are forever**: `alfa:main`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys and actions. Features only grow.
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/sinapsi-alfa-state.json`; a file that cannot be
  read is never written over.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects; the catalog
  `description` holds 10 to 100 characters per language; never a `default`
  on a secret; no config key starting with `gladys_`.
- **User-facing text** is bilingual (English and French), docs kept in sync.
  Files are UTF-8 without BOM nor control bytes (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network but local servers on 127.0.0.1.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
