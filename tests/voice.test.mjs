import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { ROOT } from './helpers.mjs';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../tools/voice/index.mjs';
import { FIND_TARGETS } from '../app/src/brain/brain.js';
import { FOODS } from '../app/src/props/food.js';
import { BUBBLE_COLORS } from '../app/src/props/bubbles.js';
import { VoiceLines } from '../app/src/audio/voiceLines.js';
import { STRINGS, stringsFor } from '../app/src/ui/strings.js';

const VOICE_DIR = ROOT + 'app/assets/voice/';
const english = LANGUAGES.find((l) => l.code === 'en');
const manifestOf = (code) => JSON.parse(readFileSync(`${VOICE_DIR}${code}/manifest.json`, 'utf8'));

test('Lumi speaks several languages, and English is the fallback', () => {
  assert.ok(LANGUAGES.length >= 6);
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.equal(new Set(LANGUAGES.map((l) => l.code)).size, LANGUAGES.length, 'language codes are unique');
  const listed = JSON.parse(readFileSync(VOICE_DIR + 'languages.json', 'utf8'));
  assert.equal(listed.default, 'en');
  assert.deepEqual(listed.languages.map((l) => l.code), LANGUAGES.map((l) => l.code), 'run "npm run build:voice" to render every language');
  for (const l of listed.languages) assert.ok(l.name.length > 0);
});

for (const lang of LANGUAGES) {
  test(`${lang.code}: has every group of lines that English has`, () => {
    const want = Object.keys(english.lines).sort();
    assert.deepEqual(Object.keys(lang.lines).sort(), want);
    for (const [group, variants] of Object.entries(lang.lines)) {
      assert.ok(Array.isArray(variants) && variants.length >= 1, `${group} is empty`);
      for (const text of variants) assert.ok(typeof text === 'string' && text.trim().length > 0, `${group} has a blank line`);
    }
  });

  test(`${lang.code}: every line has been rendered to audio`, () => {
    const manifest = manifestOf(lang.code);
    assert.equal(manifest.lang, lang.code);
    for (const [group, variants] of Object.entries(lang.lines)) {
      assert.equal(manifest.groups[group]?.length, variants.length, `group ${group}`);
      variants.forEach((text, i) => {
        const id = `${group}_${i + 1}`;
        assert.equal(manifest.lines[id]?.t, text, `${lang.code}/${id} is out of date: run "npm run build:voice -- --lang ${lang.code}"`);
        const file = `${VOICE_DIR}${lang.code}/${id}.m4a`;
        assert.ok(existsSync(file), `${lang.code}/${id}.m4a is missing`);
        assert.ok(statSync(file).size > 1500, `${lang.code}/${id}.m4a looks empty`);
        const d = manifest.lines[id].d;
        assert.ok(d > 0.2 && d < 5, `${lang.code}/${id} lasts ${d}s`);
      });
    }
  });

  test(`${lang.code}: lines are short enough for a three-year-old`, () => {
    for (const [group, variants] of Object.entries(lang.lines)) {
      for (const text of variants) {
        const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
        assert.ok(words.length <= 9, `"${text}" (${group}) has too many words`);
        assert.ok([...text].length <= 46, `"${text}" (${group}) is too long`);
      }
    }
  });

  test(`${lang.code}: the grown-ups' panel is fully translated`, () => {
    assert.ok(STRINGS[lang.code], 'add this language to app/src/ui/strings.js');
    for (const key of Object.keys(STRINGS.en)) {
      assert.ok(typeof STRINGS[lang.code][key] === 'string' && STRINGS[lang.code][key].length > 0, `missing "${key}"`);
    }
    assert.deepEqual(Object.keys(STRINGS[lang.code]).sort(), Object.keys(STRINGS.en).sort(), 'no stray keys');
  });
}

test('everything the behaviour code tries to say exists in every language', () => {
  const src = readFileSync(ROOT + 'app/src/brain/brain.js', 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/speak\('([a-z_0-9]+)'[,)]/g)) used.add(m[1]);
  for (const m of src.matchAll(/voice: '([a-z_0-9]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/pick\(\[([^\]]+)\]\)/g)) for (const s of m[1].matchAll(/'([a-z_0-9]+)'/g)) if (!/talkGesture|dance/.test(s[1])) used.add(s[1]);
  for (const m of src.matchAll(/: '(name_[a-z]+)'/g)) used.add(m[1]); // PART_LINE values
  for (const m of src.matchAll(/first \? '([a-z_]+)' :/g)) used.add(m[1]); // first-run greeting
  assert.ok(used.size > 30, 'found the speak() calls');
  assert.ok(used.has('intro') && used.has('snack_please') && used.has('name_nose'));
  for (const t of FIND_TARGETS) used.add(t.ask);
  for (const f of FOODS) used.add(f);
  for (const c of BUBBLE_COLORS) used.add(c.name);
  for (const a of ['cow', 'duck', 'cat', 'dog', 'sheep']) used.add(a + '_q').add(a + '_a');
  for (let i = 1; i <= 10; i++) used.add('n' + i);
  for (const lang of LANGUAGES) {
    const manifest = manifestOf(lang.code);
    for (const name of used) assert.ok(name in manifest.groups || name in manifest.lines, `${lang.code}: nothing to say for "${name}"`);
  }
  // and nothing is translated for no reason: every group is mentioned by the behaviour code
  for (const group of Object.keys(english.lines)) {
    assert.ok(used.has(group) || src.includes(`'${group}'`), `group "${group}" is never used by the behaviour code`);
  }
});

test('the language follows the device unless a grown-up chose one', () => {
  const v = new VoiceLines({ ready: false });
  v.languages = LANGUAGES.map((l) => ({ code: l.code, name: l.name }));
  v.defaultLang = 'en';
  assert.equal(v.resolve('auto', ['zh-CN', 'en-US']), 'zh');
  assert.equal(v.resolve('auto', ['pt-BR']), 'pt');
  assert.equal(v.resolve('auto', ['sv-SE', 'fr-CA', 'en']), 'fr', 'first preferred language that Lumi speaks');
  assert.equal(v.resolve('auto', ['sv-SE']), 'en', 'falls back to English');
  assert.equal(v.resolve('auto', []), 'en');
  assert.equal(v.resolve('ja', ['en-US']), 'ja', 'an explicit choice wins');
  assert.equal(v.resolve('xx', ['de-DE']), 'en', 'an unknown choice falls back');
});

test('the same line is not picked twice in a row', () => {
  const v = new VoiceLines({ ready: false });
  v.manifest = manifestOf('en');
  let last = null;
  for (let i = 0; i < 40; i++) {
    const id = v.pick('hello');
    assert.notEqual(id, last);
    last = id;
  }
  assert.equal(v.pick('n3'), 'n3_1', 'single-variant groups always return their one line');
  assert.equal(v.pick('hello_2'), 'hello_2', 'an exact id can be requested');
  assert.equal(v.pick('no_such_group'), null);
  assert.equal(v.say('hello'), null, 'nothing is said while audio is locked');
});

test('missing panel text falls back to English rather than showing nothing', () => {
  assert.equal(stringsFor('xx').title, STRINGS.en.title);
  assert.equal(stringsFor('de').title, STRINGS.de.title);
});
