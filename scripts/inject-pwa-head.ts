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
import { readFileSync, writeFileSync } from 'node:fs';
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
