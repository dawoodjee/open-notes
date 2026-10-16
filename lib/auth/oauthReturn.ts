/**
 * Native: a provider's answer arrives inside the in-app browser session
 * (lib/auth/oauth.ts), never in a page load, so there is nothing to capture.
 * The web twin is lib/auth/oauthReturn.web.ts.
 */
export function takeOAuthReturn(): Record<string, string> | null {
  return null;
}
