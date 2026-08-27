/**
 * Write the PWA head tags into the exported `dist/index.html`.
 *
 * Run by `npm run build:web` immediately after `expo export`. It exists because
 * Expo's SPA output (`web.output: "single"`) emits a fixed HTML template and
 * ignores `app/+html.tsx` -- see lib/pwa/headTags.ts for the full reasoning.
 *
 * Idempotent: every tag declares what it replaces, so running it twice produces
 * the same file.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PWA_HEAD_TAGS, renderHeadTag } from '../lib/pwa/headTags';

const FILE = 'dist/index.html';

let html: string;
try {
  html = readFileSync(FILE, 'utf8');
} catch {
  console.error(`${FILE} not found -- run \`npx expo export --platform web\` first.`);
  process.exit(1);
}

let replaced = 0;
let appended = 0;

for (const spec of PWA_HEAD_TAGS) {
  const rendered = renderHeadTag(spec);

  // Match the existing tag by its identifying attribute rather than by a full
  // CSS selector: there is no DOM here, and a regex over one attribute is both
  // sufficient and far less likely to mangle the document than a parser
  // dependency would be.
  const identifier =
    spec.tag === 'meta'
      ? `name="${spec.attrs.name}"`
      : spec.tag === 'link'
        ? `rel="${spec.attrs.rel}"`
        : `id="${spec.attrs.id}"`;

  const pattern = new RegExp(
    `<${spec.tag}\\b[^>]*${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*(?:/>|>(?:[\\s\\S]*?</${spec.tag}>)?)`,
    'i'
  );

  if (pattern.test(html)) {
    html = html.replace(pattern, rendered);
    replaced += 1;
  } else {
    html = html.replace('</head>', `  ${rendered}\n</head>`);
    appended += 1;
  }
}

writeFileSync(FILE, html);

// Fail loudly rather than produce a page that merely looks fine. A manifest
// that did not land is an app that cannot be installed, and nothing about the
// built output would say so.
if (!html.includes('rel="manifest"')) {
  console.error('Injection ran but no manifest link is present -- refusing to call this a build.');
  process.exit(1);
}

console.log(`PWA head tags: ${replaced} replaced, ${appended} appended in ${FILE}`);

// ─── Service worker precache ───────────────────────────────────────────────

/**
 * Write the real asset list into `dist/sw.js`.
 *
 * WHY THIS IS GENERATED. A service worker installs DURING the first page load
 * and does not control that page, so the hashed `_expo/static/js/web/*.js`
 * bundles are fetched before it exists and a cache-first strategy never sees
 * them. Install, go offline, reload -> the HTML came from cache and every
 * script under it failed. That is the blank screen Adam hit, and it is not
 * fixable from inside the worker: those filenames contain content hashes, so
 * they cannot be listed by hand either.
 */
const SW = 'dist/sw.js';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Everything except the worker itself (it must not cache its own body -- that
// is how a broken worker becomes permanent) and build metadata.
const EXCLUDED = new Set(['sw.js', 'metadata.json']);

const assets = walk('dist')
  .map((f) => '/' + relative('dist', f).split(sep).join('/'))
  .filter((url) => !EXCLUDED.has(url.slice(1)))
  // `/index.html` is served at `/`, and caching both would store the shell
  // twice under keys the navigation handler does not look up.
  .filter((url) => url !== '/index.html')
  .sort();

// A stamp over the asset names, so a build that changes any hashed filename
// gets a new cache and the activate handler evicts the previous one. Without
// it a redeploy would serve yesterday's bundle out of a cache keyed by a
// constant.
const stamp = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);

let sw = readFileSync(SW, 'utf8');
const before = sw;

sw = sw.replace(
  /^const BUILD_ASSETS = .*$/m,
  `const BUILD_ASSETS = ${JSON.stringify(assets)};`
);
sw = sw.replace(
  /^const CACHE_VERSION = .*$/m,
  `const CACHE_VERSION = 'notes-shell-${stamp}';`
);

if (sw === before) {
  console.error(`Could not write the precache list into ${SW} -- the marker lines have moved.`);
  process.exit(1);
}

writeFileSync(SW, sw);
console.log(`Service worker: ${assets.length} assets precached, cache notes-shell-${stamp}`);
