import * as WebBrowser from 'expo-web-browser';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '@/lib/supabase/client';

// Must exactly match an entry in supabase/config.toml's
// additional_redirect_urls (already registered there in Stage 4,
// specifically for this) and app.json's "scheme".
export const REDIRECT_TO = 'notes://';

// RN has no browser location/hash the way a web app does -- the tokens come
// back appended to the redirect URL as a fragment (#access_token=...), and
// expo-auth-session's QueryParams is what actually parses that out. Calling
// supabase.auth.setSession() here is what fires the SIGNED_IN event that
// AuthContext's onAuthStateChange listener picks up -- this function itself
// never touches session/connect state directly.
async function createSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) return;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
  if (result.type === 'success') {
    await createSessionFromUrl(result.url);
  }
  return result.type;
}
