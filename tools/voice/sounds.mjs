// Lumi's wordless sounds: giggles, "wheee!", coos, yawns. They mean the same in
// every language, so there is one set, recorded in the same voice as her words
// (`npm run build:voice -- --lang sounds`).
//
// `say` is what the speech model is given to perform, with a few variants so
// she does not make the identical sound twice running; `direction` is how; and
// `longest` is how many seconds the sound may last, because the behaviour code
// leaves each one only so much room before she speaks again (if she does speak
// while one is still going, the words win and the sound stops).
//
// A sound that is not here (or has not loaded yet) comes from the little
// synthesizer in app/src/audio/vocal.js instead, as her singing, snoring,
// sneezing and munching still do.
export default {
  giggle: { direction: 'giggling, ticklish', longest: 1.7, say: ['Hee hee hee!', 'Tee hee hee!', 'Hee hee hee hee!', 'Hee hee!'] },
  whee: { direction: 'thrilled, sliding down a slide', longest: 1.2, say: ['Wheee!', 'Wheeee!', 'Whee!'] },
  yay: { direction: 'excited, cheering', longest: 1.0, say: ['Yay!', 'Yaay!', 'Yay!'] },
  oh: { direction: 'surprised', longest: 0.9, say: ['Oh!', 'Ooh!', 'Oh!'] },
  hup: { direction: 'jumping, playful', longest: 0.6, say: ['Hup!', 'Hup!'] },
  coo: { direction: 'content and cosy, being stroked', longest: 1.1, say: ['Mmmm.', 'Ooooh.', 'Mmm.'] },
  babble: { direction: 'babbling happily to herself', longest: 2.4, say: ['Ba-da, la-la, doo!', 'La-di, da-ba, boo!', 'Doo-ba, dee-la, da!', 'Ma-la, bee-bo, la!'] },
  yawn: { direction: 'a big sleepy yawn', longest: 2.6, say: ['Aaaah, hmm.', 'Haaaah, mmm.', 'Aaaah.'] },
  kiss: { direction: 'blowing a kiss, loving', longest: 0.9, say: ['Mwah!', 'Mwah!', 'Mwah!'] },
};
