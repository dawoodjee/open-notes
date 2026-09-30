import { describe, it, expect } from './harness';
import { SIGNUPS_CLOSED_MESSAGE, isSignupClosedError } from '../lib/auth/signups';
import { classifyOAuthError, OAuthExpiredError } from '../lib/auth/oauthErrors';

describe('isSignupClosedError — the email code request', () => {
  it("recognises GoTrue's signup_disabled (measured on the dev stack)", () => {
    expect(isSignupClosedError({ code: 'signup_disabled', message: 'Signups not allowed for this instance' })).toBe(true);
  });

  it('recognises otp_disabled, the same refusal when create_user is false', () => {
    expect(isSignupClosedError({ code: 'otp_disabled' })).toBe(true);
  });

  it('goes by the code, not the wording', () => {
    expect(isSignupClosedError({ code: 'over_email_send_rate_limit', message: 'Signups not allowed' })).toBe(false);
  });

  it('is safe on a network error with no code at all', () => {
    expect(isSignupClosedError(new Error('Network request failed'))).toBe(false);
    expect(isSignupClosedError(null)).toBe(false);
  });
});

describe('classifyOAuthError — a new Google account on a closed server', () => {
  it('by error_code', () => {
    const error = classifyOAuthError({
      error: 'access_denied',
      error_code: 'signup_disabled',
      error_description: 'Signups+not+allowed+for+this+instance',
    });
    expect(error?.message).toBe(SIGNUPS_CLOSED_MESSAGE);
  });

  it('by description alone, in its +-encoded redirect form', () => {
    const error = classifyOAuthError({ error: 'server_error', error_description: 'Signups+not+allowed+for+this+instance' });
    expect(error?.message).toBe(SIGNUPS_CLOSED_MESSAGE);
  });

  it('leaves the other classifications alone', () => {
    expect(classifyOAuthError({ error_code: 'bad_oauth_state' }) instanceof OAuthExpiredError).toBe(true);
    expect(classifyOAuthError({})).toBe(null);
  });
});
