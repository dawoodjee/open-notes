import { describe, it, expect } from './harness';
import { PWA_HEAD_TAGS, THEME_COLOR, renderHeadTag } from '../lib/pwa/headTags';

describe('PWA head tags', () => {
  it('links a manifest, which is what makes the app installable at all', () => {
    const manifest = PWA_HEAD_TAGS.find((t) => t.attrs.rel === 'manifest');
    expect(manifest?.attrs.href).toBe('/manifest.webmanifest');
  });

  it('gives EVERY tag a `replaces` selector', () => {
    // This is what makes scripts/inject-pwa-head.ts idempotent. A tag without
    // one is appended on every run, so a second build silently produces two
    // viewport tags -- of which the browser honours the first, i.e. the wrong
    // one.
    expect(PWA_HEAD_TAGS.every((t) => typeof t.replaces === 'string')).toBe(true);
  });

  it('replaces the viewport rather than adding a second one', () => {
    // Expo's SPA template already ships a viewport. Two do not merge.
    const viewport = PWA_HEAD_TAGS.find((t) => t.attrs.name === 'viewport');
    expect(viewport?.replaces).toBe('meta[name="viewport"]');
    expect(viewport?.attrs.content ?? '').toContain('viewport-fit=cover');
  });

  it('renders self-closing tags for meta and link', () => {
    expect(renderHeadTag({ tag: 'meta', attrs: { name: 'theme-color', content: '#000' } })).toBe(
      '<meta name="theme-color" content="#000" />'
    );
  });

  it('renders style tags with their text', () => {
    const rendered = renderHeadTag({ tag: 'style', attrs: { id: 'x' }, text: 'body{}' });
    expect(rendered).toBe('<style id="x">body{}</style>');
  });

  it('escapes attribute values, since these are written into HTML', () => {
    const rendered = renderHeadTag({ tag: 'meta', attrs: { name: 'x', content: 'a"b&c' } });
    expect(rendered).toContain('a&quot;b&amp;c');
  });

  it('uses the app background as the theme colour', () => {
    // Matches BACKGROUND.dark in contexts/ThemeContext.tsx. If that changes and
    // this does not, the browser chrome no longer matches the app it frames.
    expect(THEME_COLOR).toBe('#0a0a0c');
  });
});
