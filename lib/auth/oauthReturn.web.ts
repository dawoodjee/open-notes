/**
 * Captures a Google sign-in return from the address bar, and wipes it, before
 * the router starts. Imported first by index.ts, ahead of expo-router/entry.
 *
 * WHY SO EARLY. Supabase sends the person back to `/web/#access_token=…`.
 * Expo Router reads the starting address once, before any app module loads,
 * turns the `#…` into route state, and then writes that state back into the
 * address bar after it mounts -- so a wipe done anywhere in the app is undone
 * and the tokens stay visible (and in history, and in any copied link). Taking
 * them out before the router has looked means it only ever sees `/web/`.
 */

/** The OAuth parameters in a returned URL: fragment (implicit flow) and query. */
export function readOAuthReturn(href: string): Record<string, string> | null {
  const url = new URL(href);
  const params: Record<string, string> = {};
  for (const source of [url.searchParams, new URLSearchParams(url.hash.replace(/^#/, ''))]) {
    source.forEach((value, key) => {
      params[key] = value;
    });
  }
  const relevant = ['access_token', 'refresh_token', 'error', 'error_code', 'error_description'];
  return relevant.some((k) => k in params) ? params : null;
}

let pending: Record<string, string> | null = null;

if (typeof window !== 'undefined' && window.location) {
  pending = readOAuthReturn(window.location.href);
  if (pending) {
    window.history.replaceState(null, '', `${window.location.origin}${window.location.pathname}`);
  }
}

/** The captured return, once: a second caller (a re-run boot effect) gets null. */
export function takeOAuthReturn(): Record<string, string> | null {
  const params = pending;
  pending = null;
  return params;
}
