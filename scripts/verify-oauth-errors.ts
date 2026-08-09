/**
 * Exercises lib/auth/oauthErrors.ts against the redirect URLs GoTrue actually
 * produces. The first case is not invented -- it's the verbatim Location
 * header the local stack returned for a stale OAuth state:
 *
 *   curl -i "http://127.0.0.1:54321/auth/v1/callback?state=expired-state-token&code=abc123"
 *   HTTP/1.1 303 See Other
 *   Location: notes:?error=invalid_request&error_code=bad_oauth_state&...
 *
 * Run: npx tsx scripts/verify-oauth-errors.ts
 */
import {
  OAuthExpiredError,
  OAuthIdentityAlreadyLinkedError,
  classifyOAuthError,
} from '../lib/auth/oauthErrors';

/** Stands in for expo-auth-session's QueryParams, which needs React Native.
 *  Same job: pull the params out of both the query and the fragment. */
function paramsFromUrl(url: string): Record<string, string | undefined> {
  const out: Record<string, string> = {};
  for (const chunk of url.split(/[?#]/).slice(1)) {
    for (const [k, v] of new URLSearchParams(chunk)) out[k] = v;
  }
  return out;
}

const cases: Array<{ name: string; url: string; expect: string | null }> = [
  {
    name: 'expired state (verbatim from local GoTrue)',
    url: 'notes:?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+parameter+is+invalid',
    expect: 'OAuthExpiredError',
  },
  {
    name: 'flow state expired',
    url: 'notes://?error=server_error&error_code=flow_state_expired',
    expect: 'OAuthExpiredError',
  },
  {
    name: 'description mentions expiry, unknown code',
    url: 'notes://?error=server_error&error_code=weird&error_description=Token+has+expired',
    expect: 'OAuthExpiredError',
  },
  {
    name: 'identity already linked elsewhere',
    url: 'notes://?error=server_error&error_code=identity_already_exists',
    expect: 'OAuthIdentityAlreadyLinkedError',
  },
  {
    name: 'other failure keeps its own message',
    url: 'notes://?error=access_denied&error_description=User+denied+access',
    expect: 'Error',
  },
  {
    name: 'real token redirect is not an error',
    url: 'notes://#access_token=eyJhbG&refresh_token=abc&token_type=bearer',
    expect: null,
  },
];

let failed = 0;
for (const c of cases) {
  const result = classifyOAuthError(paramsFromUrl(c.url));
  const actual = result === null ? null : result.constructor.name;
  const ok = actual === c.expect;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      -> ${actual ?? 'null'}${
      result ? `: "${result.message}"` : ''
    }`
  );
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
