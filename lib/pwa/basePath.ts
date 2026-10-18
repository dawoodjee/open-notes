/**
 * Where the web app lives on its domain: '' for the root, or e.g. '/web'.
 *
 * WHY THIS EXISTS. The hosted web app sits at `/web` on a domain whose root is
 * the website. Every absolute URL the app uses -- the service worker, the
 * PowerSync worker, the manifest and its icons, the offline precache list --
 * used to assume `/`, and each one breaks quietly at a sub-path: a 404 for a
 * worker is not an error anyone sees, it is just an app that never goes
 * offline-capable, or never opens its database.
 *
 * The value is set ONCE, as `WEB_BASE_URL` at build time: app.config.ts hands
 * it to Expo as `experiments.baseUrl`, and Expo both prefixes its own files and
 * writes it into the bundle as `process.env.EXPO_BASE_URL`. The build script
 * (scripts/inject-pwa-head.ts) reads `WEB_BASE_URL` directly. Unset means the
 * root, so development and self-hosters at `/` change nothing.
 */

/** '' | '/web' -- leading slash, no trailing slash. Tolerates sloppy input. */
export function normalizeBase(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** The base this bundle was built for. Inlined by Expo; undefined in Node. */
export const BASE_PATH = normalizeBase(process.env.EXPO_BASE_URL);

/** Prefix an absolute app path with the base: withBase('/sw.js', '/web') -> '/web/sw.js'. */
export function withBase(path: string, base: string = BASE_PATH): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}
