// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  INDEX_MAX_KW_DEFAULT,
  INDEX_MAX_KW_MAX,
  INDEX_MAX_KW_MIN,
} from '../src/constants.js';
import { ORDER, buildDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics; one version everywhere (the Release workflow owns it)', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-sinapsi-alfa:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-sinapsi-alfa');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.ok(!('keywords' in manifest) && !('countries' in manifest));
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-sinapsi-alfa\//,
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('the cover is an 800 x 534 PNG', () => {
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('the docs say it was never tested with a real device', () => {
  assert.match(read('docs/fr.md'), /[Jj]amais\s+testé\s+avec\s+un\s+vrai\s+appareil/);
  assert.match(read('docs/en.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+device/);
  assert.match(read('README.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+device/);
});

test('versions: semver, the same four times, never pinned in a test', () => {
  const versions = [
    manifest.version,
    manifest.docker_image.split(':').at(-1),
    pkg.version,
    lock.packages[''].version,
  ];
  for (const v of versions) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(new Set(versions).size, 1, versions.join(' '));
});

test('every supported_options label is a string (the fake Gladys does not check it)', () => {
  const walk = (node) =>
    Array.isArray(node)
      ? node.flatMap(walk)
      : node && typeof node === 'object'
        ? [
            ...(Array.isArray(node.supported_options) ? node.supported_options : []),
            ...Object.values(node).flatMap(walk),
          ]
        : [];
  const device = buildDevice(
    { externalIds: () => ({ device: 'ext:x:alfa:main', feature: (k) => `ext:x:alfa:main:${k}` }) },
    new Set(ORDER),
    '1.2.3.4',
  );
  for (const option of walk([manifest, device])) {
    assert.equal(typeof option.label, 'string', JSON.stringify(option));
  }
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema) {
    if ('placeholder' in field) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}.placeholder`);
    }
  }
});

test('the configuration matches the code: an address, the margin; no key named gladys_', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(fields), ['intro', 'address', 'max_power_kw']);
  for (const key of Object.keys(fields)) {
    assert.ok(!key.startsWith('gladys_'), key);
  }
  assert.equal(fields.address.type, 'string');
  assert.equal(fields.address.required, true);
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.ok(!('default' in field), `${field.key}: never a default on a secret`);
  }
  assert.equal(fields.max_power_kw.type, 'number');
  assert.equal(fields.max_power_kw.default, INDEX_MAX_KW_DEFAULT);
  assert.equal(fields.max_power_kw.min, INDEX_MAX_KW_MIN);
  assert.equal(fields.max_power_kw.max, INDEX_MAX_KW_MAX);
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code; read-only', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(handlers.includes('onAction(ACTIONS.TEST'));
  assert.ok(handlers.includes('onAction(ACTIONS.ACCEPT_HELD'));
  assert.ok(handlers.includes('onDeviceCreated'));
  assert.ok(handlers.includes("on('connected'"));
  assert.ok(index.includes('registerHandlers(gladys, app'));
  assert.ok(!index.includes('onSetValue') && !handlers.includes('onSetValue'), 'read-only');
  const client = read('src/alfa/client.js');
  const code = client.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Read holding registers (3) is the only function code in the client.
  assert.match(code, /const READ_HOLDING = 3;/);
  for (const word of ['WRITE', 'write(address', 'writeRegister', 'logger']) {
    assert.ok(!code.includes(word), `never ${word}`);
  }
});

test('the device: core units only, one index per kind, nothing writable', () => {
  const external = {
    device: 'ext:sinapsi-alfa:alfa:main',
    feature: (key) => `ext:sinapsi-alfa:alfa:main:${key}`,
  };
  const device = buildDevice({ externalIds: () => external }, new Set(ORDER), '1.2.3.4');
  assert.equal(device.features.length, ORDER.length);
  const units = {
    'energy-sensor': ['watt', 'kilowatt-hour'],
    'energy-production-sensor': ['watt', 'kilowatt-hour'],
    'grid-sensor': ['watt', 'kilowatt-hour'],
    unknown: [undefined],
  };
  for (const feature of device.features) {
    assert.ok(units[feature.category].includes(feature.unit), feature.external_id);
    assert.equal(feature.read_only, true);
  }
  const kinds = (category, types) =>
    device.features
      .filter((f) => f.category === category && types.includes(f.type))
      .map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(kinds('energy-sensor', ['index', 'energy']), ['import_index']);
  assert.deepEqual(kinds('energy-production-sensor', ['index']), ['production_index']);
  assert.deepEqual(kinds('grid-sensor', ['output-index']), ['export_index']);
  assert.deepEqual(kinds('energy-sensor', ['power']), ['power']);
  assert.ok(!device.features.some((f) => ['switch', 'binary'].includes(f.category)));
});

test('the licenses ship in the image; no name in LICENSE', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /ha-sinapsi-alfa/);
  assert.match(notices, /Copyright \(c\) 2024 Alessandro Del Prete/);
  assert.match(notices, /MIT License/);
});

test('the code never feeds the energy consumption endpoint nor scene events', () => {
  for (const file of ['index.js', 'src/app.js', 'src/devices.js']) {
    assert.doesNotMatch(read(file), /publishEnergyConsumption\(/, file);
    assert.doesNotMatch(read(file), /publishSceneEvent\(/, file);
  }
});
