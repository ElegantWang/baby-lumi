// The languages Lumi speaks. Each entry names the macOS voice that reads the
// lines and how much to raise its pitch: voices differ in how high they
// naturally speak, so the shift is chosen per voice to land every language in
// the same small, bright register (roughly 220-290 Hz).
//
// To add a language: copy en.mjs to <code>.mjs, translate the lines (keep every
// group), add an entry here, add the grown-ups' panel text in
// app/src/ui/strings.js, then run `npm run build:voice -- --lang <code>`.
import en from './en.mjs';
import zh from './zh.mjs';
import es from './es.mjs';
import fr from './fr.mjs';
import de from './de.mjs';
import ja from './ja.mjs';
import ko from './ko.mjs';
import pt from './pt.mjs';

export const LANGUAGES = [
  { code: 'en', name: 'English', voice: 'Samantha', pitch: 1.28, lines: en },
  { code: 'zh', name: '中文', voice: 'Tingting', pitch: 1.2, lines: zh },
  { code: 'es', name: 'Español', voice: 'Paulina', pitch: 1.34, lines: es },
  { code: 'fr', name: 'Français', voice: 'Amélie', pitch: 1.2, lines: fr },
  { code: 'de', name: 'Deutsch', voice: 'Anna', pitch: 1.34, lines: de },
  { code: 'ja', name: '日本語', voice: 'Kyoko', pitch: 1.14, lines: ja },
  { code: 'ko', name: '한국어', voice: 'Yuna', pitch: 1.13, lines: ko },
  { code: 'pt', name: 'Português', voice: 'Luciana', pitch: 1.27, lines: pt },
];

export const DEFAULT_LANGUAGE = 'en';
