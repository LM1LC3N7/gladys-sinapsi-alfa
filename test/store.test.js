// -----------------------------------------------------------------------------
// The file store of /data (src/store.js): a missing file is an empty state, a
// file that cannot be read is NOT one; saves one after the other.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/store.js';

async function dir(t) {
  const path = await mkdtemp(join(tmpdir(), 'sinapsi-alfa-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('missing: empty; saved: read back; saves in a row: the last one', async (t) => {
  const file = join(await dir(t), 'state.json');
  const store = createFileStore(file);
  assert.deepEqual(store.load(), {});
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 }), store.save({ a: 3 })]);
  assert.deepEqual(store.load(), { a: 3 });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { a: 3 });
});

test('not JSON, not an object, too large: unreadable, never an empty state', async (t) => {
  const base = await dir(t);
  for (const [name, content] of [
    ['bad.json', '{nope'],
    ['array.json', '[1,2]'],
    ['big.json', JSON.stringify({ x: 'y'.repeat(300 * 1024) })],
  ]) {
    const file = join(base, name);
    await writeFile(file, content);
    assert.deepEqual(createFileStore(file).load(), { unreadable: true }, name);
  }
  // A directory in its place cannot be read either.
  assert.deepEqual(createFileStore(base).load(), { unreadable: true });
});
