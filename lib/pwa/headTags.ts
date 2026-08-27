/**
 * The `<head>` tags a PWA needs, defined once.
 *
 * ── WHY THIS IS DATA AND NOT AN `app/+html.tsx` ───────────────────────────
 *
 * `+html.tsx` is the documented way to control the HTML shell, and it does
 * nothing here. It is only consulted by Expo's STATIC renderer; this app builds
 * with `web.output: "single"` (an SPA), where Expo emits its own fixed
 * template and never reads that file. Written, exported, and silently ignored
 * -- the generated `dist/index.html` came out as the stock template with no
 * manifest link at all.
 *
 * Switching to `output: "static"` would make `+html.tsx` work and would also
 * turn on per-route prerendering, which an auth-gated app whose providers touch
 * browser APIs at module scope has no reason to take on for the sake of four
 * meta tags.
 *
 * So the tags live here as plain data with two consumers that must not drift:
 *
 *   - `injectPwaHead()` in install.web.ts, at runtime, so `expo start --web`
 *     behaves like the built app;
 *   - `scripts/inject-pwa-head.ts`, which writes them into `dist/index.html`
 *     after an export, so the SHIPPED page carries them statically. That one
 *     matters: Chrome's installability check is most reliable when the manifest
 *     is linked in the served HTML rather than added by script afterwards.
 *
 * No imports, deliberately -- the build script runs under plain Node, where
 * anything reaching `react-native` cannot be transformed.
 */

export interface HeadTag {
  tag: 'meta' | 'link' | 'style';
  attrs: Record<string, string>;
  /** `style` only. */
  text?: string;
  /**
   * Matches an existing tag that this one REPLACES rather than joins. Expo's
   * template already ships a viewport, and two viewport tags do not merge --
   * the first wins, so appending a better one silently does nothing.
   */
  replaces?: string;
}

/** Matches `BACKGROUND.dark` in contexts/ThemeContext.tsx. */
export const THEME_COLOR = '#0a0a0c';

export const PWA_HEAD_TAGS: HeadTag[] = [
  {
    tag: 'link',
    attrs: { rel: 'manifest', href: '/manifest.webmanifest' },
    replaces: 'link[rel="manifest"]',
  },
  {
    tag: 'link',
    attrs: { rel: 'apple-touch-icon', href: '/icons/icon-192.png' },
    replaces: 'link[rel="apple-touch-icon"]',
  },
  {
    /**
     * ONE colour, and deliberately the dark one. `theme-color` paints the
     * browser chrome around the app, and the shipped HTML is static -- it
     * cannot know whether this user chose light. A `prefers-color-scheme` pair
     * would follow the DEVICE, which is exactly what the in-app preference
     * overrides, so it would be wrong for anyone who chose against their
     * system. The app's own surfaces are correct either way; only the strip
     * around them is fixed, and dark recedes rather than flashing white.
     */
    tag: 'meta',
    attrs: { name: 'theme-color', content: THEME_COLOR },
    replaces: 'meta[name="theme-color"]',
  },
  {
    /**
     * `viewport-fit=cover` so an installed app reaches under the notch.
     * REPLACES Expo's own viewport tag -- appending a second one does nothing,
     * because the first is the one the browser honours.
     */
    tag: 'meta',
    attrs: {
      name: 'viewport',
      content:
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    },
    replaces: 'meta[name="viewport"]',
  },
  // iOS Safari predates the manifest's `display` field and reads these instead.
  {
    tag: 'meta',
    attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' },
    replaces: 'meta[name="apple-mobile-web-app-capable"]',
  },
  {
    tag: 'meta',
    attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    replaces: 'meta[name="apple-mobile-web-app-status-bar-style"]',
  },
  {
    tag: 'meta',
    attrs: { name: 'apple-mobile-web-app-title', content: 'Notes' },
    replaces: 'meta[name="apple-mobile-web-app-title"]',
  },
  {
    /** Paint the background before the bundle loads, so a cold start does not
     *  flash white in front of a dark app. */
    tag: 'style',
    attrs: { id: 'pwa-preload-background' },
    text: `html,body{background-color:${THEME_COLOR};}`,
    replaces: 'style#pwa-preload-background',
  },
];

/** Serialise one tag to HTML, for the build-time consumer. */
export function renderHeadTag(tag: HeadTag): string {
  const attrs = Object.entries(tag.attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ');
  if (tag.tag === 'style') return `<style ${attrs}>${tag.text ?? ''}</style>`;
  return `<${tag.tag} ${attrs} />`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
