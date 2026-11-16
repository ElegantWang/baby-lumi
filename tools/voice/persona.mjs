// Who Lumi sounds like: a small, sweet cartoon creature.
//
// Her voice is a short recording that the speech model imitates for every
// line, so she is always the same character. The recording is not a person: it
// was itself generated from the written description below (see
// tools/design-voice.mjs, which makes new candidates).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const VOICE = {
  // text-to-speech model, reached through OpenRouter (https://openrouter.ai)
  model: 'fish-audio/drama-3',
  // the description her recordings were generated from
  description: 'The voice of a small fluffy baby animal in an animated preschool series: high, soft and round, giggly and gentle, each word clear and unhurried.',
  // how far (in semitones) a line may stray from the pitch of the recording
  // before it no longer sounds like her and is recorded again; a giggle or a
  // "wheee!" may go higher than a sentence
  spread: 5.5,
  soundSpread: 8.5,
};

// The recordings she is modelled on, and exactly what is said in each.
//
// A voice keeps the accent of its recording. Modelled on the English one, her
// Chinese, Japanese, Korean and Portuguese sound native, but her Spanish,
// French and German came out with an American accent. So those three have a
// recording of their own: the same description, performed in that language.
// Every other language, and her wordless sounds, use the English one.
export const REFERENCES = {
  en: { file: 'lumi.wav', text: "Hi! I'm Lumi! I love playing with you. Can you find my nose? Yay, you found it! Now I'm a little bit sleepy. Good night, sweet dreams." },
  es: { file: 'lumi.es.wav', text: '¡Hola! ¡Soy Lumi! Me encanta jugar contigo. ¿Dónde está mi nariz? ¡Bravo, la encontraste! Ahora tengo un poquito de sueño. Buenas noches, dulces sueños.' },
  fr: { file: 'lumi.fr.wav', text: "Coucou ! Je m'appelle Loumi ! J'adore jouer avec toi. Où est mon nez ? Bravo, tu l'as trouvé ! Maintenant, j'ai un petit peu sommeil. Bonne nuit, fais de beaux rêves." },
  de: { file: 'lumi.de.wav', text: 'Hallo! Ich bin Lumi! Ich spiele so gern mit dir. Wo ist meine Nase? Juhu, du hast sie gefunden! Jetzt bin ich ein bisschen müde. Gute Nacht, träum schön.' },
};

/** The recording a language is modelled on. @returns {{url: URL, text: string}} */
export function referenceFor(code) {
  const r = REFERENCES[code] || REFERENCES.en;
  return { url: new URL('./' + r.file, import.meta.url), text: r.text };
}

// How a line is delivered. The words on the right are the direction given to
// the speech model, as you would direct an actor.
export const MOODS = {
  happy: 'cheerful and bubbly',
  excited: 'excited, cheering',
  giggly: 'giggling, ticklish',
  gentle: 'sweet and loving',
  sleepy: 'sleepy and soft',
  asking: 'curious and playful',
  playful: 'playful and silly',
  amazed: 'amazed, full of wonder',
};

// Short happy shouts ("Six!", "Boop!") can come out as a squeal. A take that
// does is recorded again with this direction instead, and without its
// exclamation marks: "again, but softer".
export const SOFTER = 'sweet, friendly and calm';

// The mood of each group of lines. Groups that are not listed are "happy".
const GROUP_MOOD = {
  pet: 'gentle', love: 'gentle', kind: 'gentle',
  tickle: 'giggly',
  nose: 'playful', excuse: 'playful', dizzy: 'playful', retry: 'playful', peek: 'playful', boo: 'playful',
  cow_a: 'playful', duck_a: 'playful', cat_a: 'playful', dog_a: 'playful', sheep_a: 'playful',
  hands: 'excited', yay: 'excited', spin: 'excited', jump: 'excited', dance: 'excited', sing: 'excited', found: 'excited',
  apple: 'excited', strawberry: 'excited', carrot: 'excited', cookie: 'excited',
  count_intro: 'excited', count_done: 'excited', bubbles: 'excited',
  wow: 'amazed', butterfly: 'amazed', flower: 'amazed', star: 'amazed',
  sleepy: 'sleepy', night: 'sleepy',
  snack_please: 'asking', bored: 'asking',
  find_nose: 'asking', find_ears: 'asking', find_tummy: 'asking', find_feet: 'asking', find_tail: 'asking', find_hands: 'asking', find_head: 'asking',
  cow_q: 'asking', duck_q: 'asking', cat_q: 'asking', dog_q: 'asking', sheep_q: 'asking',
};

export const GROUPS_WITH_A_MOOD = Object.keys(GROUP_MOOD);

/** @returns {keyof typeof MOODS} */
export const moodOf = (group) => GROUP_MOOD[group] || 'happy';

const fileHashes = new Map();

/**
 * A short fingerprint of everything that decides how a line sounds: the words,
 * the direction, and the recording that language is modelled on. It is stored
 * with each rendered line, so the build can skip lines that are up to date and
 * the tests can tell when one needs rendering again.
 */
export function signature(text, group, lang = 'en', direction = MOODS[moodOf(group)]) {
  const ref = referenceFor(lang);
  if (!fileHashes.has(ref.url.href)) fileHashes.set(ref.url.href, createHash('sha1').update(readFileSync(ref.url)).digest('hex'));
  return createHash('sha1')
    .update([VOICE.model, fileHashes.get(ref.url.href), ref.text, direction, text].join('\n'))
    .digest('hex')
    .slice(0, 10);
}
