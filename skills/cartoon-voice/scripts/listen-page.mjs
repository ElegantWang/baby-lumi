// Makes a page for a person to listen with: every audio file under a folder,
// with what it says beside it (from manifest.json or candidates.json where
// there is one), a click to play, and "Play all" for each group.
//
//   node listen-page.mjs assets/voice               writes assets/voice/listen.html
//   node listen-page.mjs voice-candidates --title "Voices for Pip" [--out somewhere/else.html]
//
// The page is one file that plays the audio where it lies, so open it straight
// from disk (macOS: open assets/voice/listen.html). It is for reviewing: leave
// it out of anything that is published.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs, stop } from './lib/args.mjs';
import { AUDIO_FILE } from './lib/audio.mjs';

const usage = 'node listen-page.mjs <folder> [--out listen.html] [--title "..."]';
const args = parseArgs({ valued: ['out', 'title'], usage });
if (args.rest.length !== 1) stop(usage);
const ROOT = resolve(args.rest[0]);
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) stop(`no such folder: ${ROOT}`);
const OUT = resolve(args.opt('out', join(ROOT, 'listen.html')));
const TITLE = args.opt('title', `Listen: ${basename(ROOT)}`);

const groups = [];
(function walk(dir) {
  const names = readdirSync(dir).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const clips = names.filter((f) => AUDIO_FILE.test(f));
  if (clips.length) {
    // what each clip says, if a tool of ours left a note of it
    const says = {};
    const read = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
    for (const [id, l] of Object.entries(read('manifest.json')?.lines || {})) says[id] = l.t;
    for (const [n, c] of Object.entries(read('candidates.json') || {})) says[n] = `${c.hz} Hz. "${c.say}"`;
    groups.push({
      name: relative(ROOT, dir) || basename(ROOT),
      clips: clips.map((f) => ({ src: relative(dirname(OUT), join(dir, f)).split('\\').join('/'), id: f.replace(AUDIO_FILE, ''), text: says[f.replace(AUDIO_FILE, '')] || '' })),
    });
  }
  for (const f of names) if (!f.startsWith('.') && statSync(join(dir, f)).isDirectory()) walk(join(dir, f));
})(ROOT);
if (!groups.length) stop(`no audio files under ${ROOT}`);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --hot: #e8590c; }
  body { font: 16px/1.4 system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 22px; }
  h2 { font-size: 17px; margin: 28px 0 8px; display: flex; gap: 12px; align-items: center; }
  h2 button { font: inherit; font-size: 14px; padding: 2px 10px; cursor: pointer; }
  .clip { display: flex; gap: 12px; width: 100%; text-align: left; font: inherit; color: inherit; background: none;
          border: 0; border-top: 1px solid var(--line); padding: 8px 4px; cursor: pointer; }
  .clip:hover { background: #8881; }
  .clip.playing { color: var(--hot); }
  .clip b { flex: 0 0 auto; min-width: 9em; font-weight: 600; overflow-wrap: anywhere; }
  .clip span { opacity: .8; }
  p { opacity: .75; }
</style>
<h1>${esc(TITLE)}</h1>
<p>Click a line to hear it. ${groups.reduce((n, g) => n + g.clips.length, 0)} recordings.</p>
${groups
  .map(
    (g, i) => `<h2>${esc(g.name)} <button data-all="${i}">Play all</button></h2>
<div data-group="${i}">
${g.clips.map((c) => `<button class="clip" data-src="${esc(encodeURI(c.src))}"><b>${esc(c.id)}</b><span>${esc(c.text)}</span></button>`).join('\n')}
</div>`,
  )
  .join('\n')}
<script>
  const player = new Audio();
  let queue = [], current = null;
  function play(el) {
    if (current) current.classList.remove('playing');
    current = el;
    el.classList.add('playing');
    el.scrollIntoView({ block: 'nearest' });
    player.src = el.dataset.src;
    player.play();
  }
  player.onended = () => {
    if (current) current.classList.remove('playing');
    const next = queue.shift();
    if (next) setTimeout(() => play(next), 350);
  };
  document.addEventListener('click', (e) => {
    const clip = e.target.closest('.clip'), all = e.target.closest('[data-all]');
    if (clip) { queue = []; play(clip); }
    if (all) {
      queue = [...document.querySelectorAll('[data-group="' + all.dataset.all + '"] .clip')];
      play(queue.shift());
    }
  });
</script>
</html>
`;
writeFileSync(OUT, html);
console.log(`${relative(process.cwd(), OUT)}  (${groups.length} group${groups.length > 1 ? 's' : ''}, ${groups.reduce((n, g) => n + g.clips.length, 0)} recordings)`);
