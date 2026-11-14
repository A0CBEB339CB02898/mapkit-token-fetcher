import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeTokenFile } from '../src/results.js';

test('atomic output replaces a token only after a successful write and cleans temporary files on abort', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mapkit-output-'));
  const file = path.join(root, 'token.txt');
  try {
    await writeFile(file, 'old');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(writeTokenFile(file, 'cancelled', controller.signal));
    assert.equal(await readFile(file, 'utf8'), 'old');
    assert.deepEqual(await readdir(root), ['token.txt']);
    await writeTokenFile(file, 'new');
    assert.equal(await readFile(file, 'utf8'), 'new');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(root), ['token.txt']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
