/**
 * Turning an OAuth failure into something worth reading.
 *
 * Deliberately free of any expo/supabase imports so it can be exercised
 * directly under Node (scripts/verify-oauth-errors.ts). The URL parsing that
 * feeds it needs React Native, which is why the two are separate files: the
 * half worth testing is the classification, not the query-string split.
 */

/**
 * The flow ran out of time -- the user left the consent screen sitting, or
 * stopped to reset a password partway through.
 *
 * Worth its own error type because it's the one OAuth failure that isn't a
 * fault: nothing is misconfigured, nothing is already linked, and the fix is
 * simply to start again. A generic "sign-in failed" would send someone
 * checking their password.
 */
export class OAuthExpiredError extends Error {
  constructor() {
    super('That took too long, so the sign-in expired. Please try again.');
    this.name = 'OAuthExpiredError';
  }
}

export class OAuthIdentityAlreadyLinkedError extends Error {
  constructor(provider: string) {
    super(
      `That ${provider} account is already linked to another account. ` +
        `Sign in to that account instead, or unlink it there first.`
    );
    this.name = 'OAuthIdentityAlreadyLinkedError';
  }
}

// GoTrue's own codes for "this flow is no longer valid". They mean slightly
// different things internally (state never existed vs. state timed out) but
// they're the same situation to the person holding the phone. Note that a
// genuinely expired state comes back as bad_oauth_state, not as anything
// containing the word "expired" -- verified against the local stack.
const EXPIRED_CODES = ['bad_oauth_state', 'flow_state_expired', 'flow_state_not_found'];

/**
 * Classify the error parameters off a redirect URL. Returns null when there's
 * no error present, i.e. the redirect is a real one carrying tokens.
 */
export function classifyOAuthError(
  params: Record<string, string | undefined>,
  provider = 'Google'
): Error | null {
  const code = params.error_code ?? params.error;
  const description = params.error_description ?? '';
  if (!code) return null;

  if (EXPIRED_CODES.includes(code) || /expired/i.test(description)) {
    return new OAuthExpiredError();
  }
  if (
    /identity_already_exists|already.+(linked|exists|registered)/i.test(`${code} ${description}`)
  ) {
    return new OAuthIdentityAlreadyLinkedError(provider);
  }

  // Supabase percent-encodes the description and uses "+" for spaces.
  return new Error(decodeURIComponent(description.replace(/\+/g, ' ')) || code);
}
