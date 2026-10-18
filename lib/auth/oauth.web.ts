import { supabase } from '@/lib/supabase/client';
import { withBase } from '@/lib/pwa/basePath';
import { classifyOAuthError } from './oauthErrors';
import { takeOAuthReturn } from './oauthReturn';

/**
 * Google sign-in on WEB. Same exports as lib/auth/oauth.ts, different mechanism.
 *
 * WHY A SEPARATE FILE. The native flow opens the system browser and asks
 * Supabase to send the person back to `notes://` -- the phone app's address. A
 * browser cannot open that, so on web Google sign-in simply could not work.
 * Here the whole page goes to Google and comes back to THIS site's base
 * (`https://<host>/web/`), and `completeOAuthRedirect` picks the session up
 * from the URL when the app boots.
 *
 * Why by hand rather than supabase-js's `detectSessionInUrl`: that option is
 * client-wide and is off for the native apps on purpose (lib/supabase/client.ts),
 * so web reads the return itself. lib/auth/oauthReturn.web.ts captures it and
 * wipes it from the address bar before the router starts; this file acts on it.
 *
 * Supabase must list the address as an allowed redirect URL: on the hosted
 * project that is a dashboard setting (docs/two-stacks.md), on the dev stack
 * `additional_redirect_urls` in supabase/config.toml.
 */

export {
  OAuthExpiredError,
  OAuthIdentityAlreadyLinkedError,
} from './oauthErrors';

export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

/** Where Google sends the person back: this site, at the web app's base. */
export const REDIRECT_TO =
  typeof window === 'undefined' ? withBase('/') : `${window.location.origin}${withBase('/')}`;

export const GOOGLE_PROMPT = { prompt: 'select_account' };

/**
 * Leave for the provider. The page navigates away, so the promise never
 * settles here -- the result arrives on the way back, via completeOAuthRedirect.
 */
export async function openOAuthSession(
  url: string,
  _provider: string
): Promise<{ type: 'success' | 'cancel' | 'dismiss'; url: string | null }> {
  window.location.assign(url);
  return new Promise(() => {});
}

export async function signInWithGoogle(): Promise<'success' | 'cancel' | 'dismiss'> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true, queryParams: GOOGLE_PROMPT },
  });
  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');
  const result = await openOAuthSession(data.url, 'Google');
  return result.type;
}

/**
 * Finish a provider round trip on app boot. Does nothing on an ordinary load.
 *
 * Tokens: start the session (AuthContext's listener takes it from there, as it
 * does for every other sign-in). An error: say so -- the person left a dialog
 * that no longer exists, so there is nowhere else for it to appear.
 */
export async function completeOAuthRedirect(): Promise<void> {
  const params = takeOAuthReturn();
  if (!params) return;

  const error = classifyOAuthError(params, 'Google');
  if (error) {
    window.alert(error.message);
    return;
  }
  if (params.access_token && params.refresh_token) {
    const { error: setError } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (setError) window.alert(`Google sign-in did not complete: ${setError.message}`);
  }
}
