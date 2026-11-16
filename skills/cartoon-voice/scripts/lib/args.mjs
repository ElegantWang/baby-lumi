// Command-line options: `--name value` for the options listed in `valued`,
// `--name` alone for those in `flags`; everything else is a positional argument.
// An option that is not listed is a mistake worth stopping for.
export function parseArgs({ valued = [], flags = [], usage = '' } = {}) {
  const argv = process.argv.slice(2);
  const values = {}, set = new Set(), rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) rest.push(a);
    else if (a === '--help') stop(usage, 0);
    else if (valued.includes(a.slice(2))) {
      if (i + 1 >= argv.length) stop(`${a} needs a value\n\n${usage}`);
      values[a.slice(2)] = argv[++i];
    } else if (flags.includes(a.slice(2))) set.add(a.slice(2));
    else stop(`unknown option ${a}\n\n${usage}`);
  }
  return {
    rest,
    opt: (name, dflt) => values[name] ?? dflt,
    list: (name, dflt) => (values[name] ? values[name].split(',').map((s) => s.trim()).filter(Boolean) : dflt),
    has: (name) => set.has(name),
  };
}

export function stop(message, code = 1) {
  (code ? console.error : console.log)(message);
  process.exit(code);
}

/** Run `fn` over `items`, `n` at a time, keeping the order of the results. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
