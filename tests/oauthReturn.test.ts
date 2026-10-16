import { describe, it, expect } from './harness';
import { readOAuthReturn } from '../lib/auth/oauthReturn.web';

describe('readOAuthReturn', () => {
  it('an ordinary load is not a return', () => {
    expect(readOAuthReturn('https://example.org/web/')).toBe(null);
    expect(readOAuthReturn('https://example.org/web/note/abc?folder=1#top')).toBe(null);
  });
  it('tokens arrive in the fragment (implicit flow)', () => {
    const p = readOAuthReturn('https://example.org/web/#access_token=a&refresh_token=r&type=signup');
    expect(p?.access_token).toBe('a');
    expect(p?.refresh_token).toBe('r');
  });
  it('a refusal can arrive in the query or the fragment', () => {
    expect(readOAuthReturn('https://example.org/web/?error=access_denied')?.error).toBe('access_denied');
    expect(readOAuthReturn('https://example.org/web/#error_code=otp_expired')?.error_code).toBe('otp_expired');
  });
});
