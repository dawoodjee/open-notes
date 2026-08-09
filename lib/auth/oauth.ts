import * as WebBrowser from 'expo-web-browser';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '@/lib/supabase/client';
import { OAuthExpiredError, classifyOAuthError } from './oauthErrors';

// Must exactly match an entry in supabase/config.toml's
// additional_redirect_urls (already registered there in Stage 4,
// specifically for this) and app.json's "scheme".
export const REDIRECT_TO = 'notes://';

/**
 * How long Supabase's OAuth "state" is valid for. GoTrue mints a one-time
 * state token when the flow starts and rejects the callback once it's stale;
 * five minutes is its default and isn't configurable from config.toml.
 *
 * We can't read that clock, so we keep our own: if the browser comes back
 * without ever having redirected and roughly that long has passed, the flow
 * was almost certainly dead before the user finished with it.
 */
export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

export {
  OAuthExpiredError,
  OAuthIdentityAlreadyLinkedError,
} from './oauthErrors';

/**
 * Inspect a redirect URL for an error the provider or GoTrue sent back.
 *
 * Failures don't arrive as a thrown exception or a non-200 -- the browser is
 * redirected to our own scheme with `?error=...&error_code=...` appended, so
 * the app sees an ordinary successful redirect carrying bad news. Returns the
 * error to throw, or null when the URL is clean.
 */
export function parseOAuthError(url: string, provider = 'Google'): Error | null {
  const { params } = QueryParams.getQueryParams(url) as {
    params: Record<string, string | undefined>;
  };
  return classifyOAuthError(params, provider);
}

/**
 * Open the provider's consent screen and wait for the redirect back.
 *
 * Wraps the two failure shapes that both reduce to "the flow expired":
 *
 *  - The redirect comes back carrying an error. This is the good case, and
 *    the only reason it *is* the good case is that supabase/config.toml's
 *    site_url points at `notes://` -- when GoTrue rejects a stale state it
 *    has no valid redirect to trust, so it falls back to site_url. Left at
 *    the default `http://127.0.0.1:3000`, the user was dumped on a dead
 *    Safari page with no route back into the app at all.
 *
 *  - The browser never redirects and the user dismisses it themselves. There
 *    is nothing to parse in that case, so we fall back to the wall clock.
 */
export async function openOAuthSession(
  url: string,
  provider: string
): Promise<{ type: 'success' | 'cancel' | 'dismiss'; url: string | null }> {
  const startedAt = Date.now();
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_TO);

  if (result.type === 'success') {
    const error = parseOAuthError(result.url, provider);
    if (error) throw error;
    return { type: 'success', url: result.url };
  }

  if (Date.now() - startedAt >= OAUTH_STATE_TTL_MS) {
    throw new OAuthExpiredError();
  }
  return { type: result.type as 'cancel' | 'dismiss', url: null };
}

// RN has no browser location/hash the way a web app does -- the tokens come
// back appended to the redirect URL as a fragment (#access_token=...), and
// expo-auth-session's QueryParams is what actually parses that out. Calling
// supabase.auth.setSession() here is what fires the SIGNED_IN event that
// AuthContext's onAuthStateChange listener picks up -- this function itself
// never touches session/connect state directly.
async function createSessionFromUrl(url: string) {
  const error = parseOAuthError(url);
  if (error) throw error;

  const { params } = QueryParams.getQueryParams(url);
  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) return;

  const { error: setError } = await supabase.auth.setSession({ access_token, refresh_token });
  if (setError) throw setError;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');

  const result = await openOAuthSession(data.url, 'Google');
  if (result.type === 'success' && result.url) {
    await createSessionFromUrl(result.url);
  }
  return result.type;
}
