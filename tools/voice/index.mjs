// The languages Lumi speaks. She has one voice for all of them (see
// persona.mjs), so a language is just its name and its words.
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
import sounds from './sounds.mjs';

export const LANGUAGES = [
  { code: 'en', name: 'English', lines: en },
  { code: 'zh', name: '中文', lines: zh },
  { code: 'es', name: 'Español', lines: es },
  { code: 'fr', name: 'Français', lines: fr },
  { code: 'de', name: 'Deutsch', lines: de },
  { code: 'ja', name: '日本語', lines: ja },
  { code: 'ko', name: '한국어', lines: ko },
  { code: 'pt', name: 'Português', lines: pt },
];

export const DEFAULT_LANGUAGE = 'en';

// Her wordless sounds (giggles, "wheee!"): not a language, but recorded and
// stored like one, in app/assets/voice/sounds/.
export const SOUNDS = { code: 'sounds', name: 'Sounds', lines: sounds };
