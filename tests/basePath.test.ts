import { describe, it, expect } from './harness';
import { normalizeBase, withBase } from '../lib/pwa/basePath';
import { pwaHeadTags } from '../lib/pwa/headTags';

describe('normalizeBase', () => {
  it('root stays root, however it is written', () => {
    for (const raw of [undefined, null, '', '/', '  ', '//']) expect(normalizeBase(raw)).toBe('');
  });
  it('a sub-path gets one leading slash and no trailing one', () => {
    for (const raw of ['web', '/web', 'web/', '/web/', ' /web ']) expect(normalizeBase(raw)).toBe('/web');
    expect(normalizeBase('apps/notes/')).toBe('/apps/notes');
  });
});

describe('withBase', () => {
  it('at the root, paths are unchanged', () => {
    expect(withBase('/sw.js', '')).toBe('/sw.js');
    expect(withBase('/@powersync/worker.js', '')).toBe('/@powersync/worker.js');
  });
  it('under /web, every app path moves with it', () => {
    expect(withBase('/sw.js', '/web')).toBe('/web/sw.js');
    expect(withBase('/', '/web')).toBe('/web/');
    expect(withBase('icons/icon-192.png', '/web')).toBe('/web/icons/icon-192.png');
  });
});

describe('pwaHeadTags at a sub-path', () => {
  it('manifest and touch icon follow the base; nothing else points at the root', () => {
    const tags = pwaHeadTags('/web');
    const hrefs = tags.map((t) => t.attrs.href).filter(Boolean);
    expect(hrefs.includes('/web/manifest.webmanifest')).toBe(true);
    expect(hrefs.includes('/web/icons/icon-192.png')).toBe(true);
    expect(hrefs.every((h) => String(h).startsWith('/web/'))).toBe(true);
  });
});
