import * as WebBrowser from 'expo-web-browser';
import { UserIdentity } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from './withTimeout';
import { REDIRECT_TO, openOAuthSession } from './oauth';

export interface IdentitySummary {
  provider: string;
  identityId: string;
  /** The email this provider knows you by -- deliberately allowed to differ
   *  from the account's primary email; linking a Google account under a
   *  different address is the main reason to link at all. */
  email: string | null;
  /** The display name the provider gave us, used to seed an unset full name.
   *  Google returns it under either key depending on the scopes granted. */
  fullName: string | null;
}

export async function listIdentities(): Promise<IdentitySummary[]> {
  const { data, error } = await withTimeout(
    supabase.auth.getUserIdentities(),
    8000,
    'Loading linked accounts'
  );
  if (error) throw error;

  return (data?.identities ?? []).map((i: UserIdentity) => ({
    provider: i.provider,
    identityId: i.identity_id,
    email: (i.identity_data?.email as string | undefined) ?? null,
    fullName:
      (i.identity_data?.full_name as string | undefined) ??
      (i.identity_data?.name as string | undefined) ??
      null,
  }));
}

/**
 * Supabase refuses to unlink an account's last remaining identity: "User must
 * have at least 1 identity after unlinking" (422). The UI disables the action
 * in that case rather than letting the tap round-trip to a rejection, so this
 * is only a helper for that decision, not the enforcement (the server is).
 *
 * Note what the rule is NOT. It isn't "you'd have no way to sign in" -- an
 * account created through Google has its email set and can sign in by OTP
 * straight away (verified against the local stack). But OTP sign-in doesn't
 * create an email identity, so such an account sits at exactly one row in
 * auth.identities forever, and that count is all Supabase looks at. The
 * user-facing copy has to reflect the real constraint, not the intuitive one.
 */
export function canUnlink(identities: IdentitySummary[]): boolean {
  return identities.length > 1;
}

// One class, not two. The same rejection can arrive from two places -- up
// front from linkIdentity(), or later on the redirect URL once Google has
// said who signed in -- and callers shouldn't have to know which. It lives in
// oauth.ts because that's where the redirect parsing happens; importing the
// other way round would make the two modules circular.
export { OAuthIdentityAlreadyLinkedError as IdentityAlreadyLinkedError } from './oauthErrors';
import { OAuthIdentityAlreadyLinkedError as IdentityAlreadyLinkedError } from './oauthErrors';

/**
 * Link an additional sign-in provider to the account you're already signed
 * into. Same browser-redirect dance as first-time OAuth sign-in (see
 * lib/auth/oauth.ts) -- the difference is linkIdentity attaches the result to
 * the current user instead of resolving to a separate one.
 *
 * The one rejection Supabase enforces is an identity that already belongs to
 * a different account; surfaced as a specific message rather than a generic
 * failure, because "already linked to another account" is a situation the
 * user can actually act on.
 */
export async function linkGoogle(): Promise<'success' | 'cancel' | 'dismiss'> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });

  if (error) {
    if (isAlreadyLinked(error)) throw new IdentityAlreadyLinkedError('Google');
    throw error;
  }
  if (!data?.url) throw new Error('No OAuth URL returned');

  // Shared with first-time sign-in (lib/auth/oauth.ts). It inspects the
  // redirect URL for the errors that arrive *as* a successful redirect --
  // notably the identity already being spoken for, which surfaces here rather
  // than from linkIdentity above, because the collision is only detectable
  // once the provider has actually identified who signed in. It also raises
  // OAuthExpiredError when the five-minute state window has run out.
  const result = await openOAuthSession(data.url, 'Google');
  return result.type;
}

export async function unlinkIdentity(identity: IdentitySummary): Promise<void> {
  const all = await listIdentities();
  if (!canUnlink(all)) {
    throw new Error(
      "This is your only linked account, so it can't be removed. Link another one first."
    );
  }

  const { data, error: fetchError } = await withTimeout(
    supabase.auth.getUserIdentities(),
    8000,
    'Loading linked accounts'
  );
  if (fetchError) throw fetchError;

  const target = (data?.identities ?? []).find((i) => i.identity_id === identity.identityId);
  if (!target) throw new Error('That account is no longer linked.');

  const { error } = await supabase.auth.unlinkIdentity(target);
  if (error) throw error;
}

function isAlreadyLinked(error: any): boolean {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');
  return (
    code === 'identity_already_exists' ||
    /already.+(linked|exists|registered)/i.test(message)
  );
}
