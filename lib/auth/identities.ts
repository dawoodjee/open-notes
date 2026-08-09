import * as WebBrowser from 'expo-web-browser';
import { UserIdentity } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from './withTimeout';
import { REDIRECT_TO } from './oauth';

export interface IdentitySummary {
  provider: string;
  identityId: string;
  /** The email this provider knows you by -- deliberately allowed to differ
   *  from the account's primary email; linking a Google account under a
   *  different address is the main reason to link at all. */
  email: string | null;
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
  }));
}

/**
 * Supabase refuses to unlink an account's last remaining identity -- that
 * would leave it with no way to sign in at all. The UI disables the action in
 * that case rather than letting the tap round-trip to a rejection, so this is
 * only a helper for that decision, not the enforcement (the server is).
 */
export function canUnlink(identities: IdentitySummary[]): boolean {
  return identities.length > 1;
}

export class IdentityAlreadyLinkedError extends Error {
  constructor(provider: string) {
    super(
      `That ${provider} account is already linked to another account. ` +
        `Sign in to that account instead, or unlink it there first.`
    );
    this.name = 'IdentityAlreadyLinkedError';
  }
}

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

  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);

  if (result.type === 'success') {
    // The redirect carries an error rather than tokens when the identity is
    // already spoken for -- the failure surfaces here, not from linkIdentity
    // above, because the collision is only detected once the provider has
    // actually identified who signed in.
    if (result.url.includes('error') && /identity_already_exists|already.+linked/i.test(result.url)) {
      throw new IdentityAlreadyLinkedError('Google');
    }
  }

  return result.type as 'success' | 'cancel' | 'dismiss';
}

export async function unlinkIdentity(identity: IdentitySummary): Promise<void> {
  const all = await listIdentities();
  if (!canUnlink(all)) {
    throw new Error(
      "This is your only way to sign in, so it can't be unlinked. Add another sign-in method first."
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
