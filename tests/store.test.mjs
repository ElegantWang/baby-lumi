import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, DEFAULT_SETTINGS } from '../app/src/brain/store.js';
import { memoryStorage } from './helpers.mjs';

test('settings start from sensible defaults and persist', () => {
  const storage = memoryStorage();
  const a = new Store(storage);
  assert.deepEqual(a.settings, DEFAULT_SETTINGS);
  const seen = [];
  a.onChange((k, v) => seen.push([k, v]));
  a.set('volume', 0.4);
  a.set('mimic', false);
  assert.deepEqual(seen, [['volume', 0.4], ['mimic', false]]);
  const b = new Store(storage);
  assert.equal(b.settings.volume, 0.4);
  assert.equal(b.settings.mimic, false);
  assert.equal(b.settings.time, 'auto', 'untouched settings keep their defaults');
});

test('new settings added in an update are filled in for existing users', () => {
  const storage = memoryStorage();
  storage.setItem('lumi.v1', JSON.stringify({ settings: { volume: 0.2 }, firstRunDone: true }));
  const s = new Store(storage);
  assert.equal(s.settings.volume, 0.2);
  assert.equal(s.settings.ambience, true);
  assert.equal(s.data.firstRunDone, true);
});

test('broken or missing storage never stops the app', () => {
  const corrupt = memoryStorage();
  corrupt.setItem('lumi.v1', '{not json');
  assert.deepEqual(new Store(corrupt).settings, DEFAULT_SETTINGS);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s = new Store(throwing);
  s.set('volume', 0.1); // must not throw
  assert.equal(s.settings.volume, 0.1);
  assert.deepEqual(new Store(null).settings, DEFAULT_SETTINGS);
});
