/**
 * The one place the app decides what an email address is.
 *
 * There were two answers before this file: Manage Account carried its own
 * regex, and the sign-in screen had none at all -- it gated Send Code on the
 * field merely being non-empty. So `otptest@exa` sailed through sign-in and
 * would have been rejected on the account sheet, which is the shape of bug
 * that only shows up once someone has already used the bad address for
 * something. Two validators for one concept is one validator too many.
 *
 * Deliberately NOT a full RFC 5322 implementation. The real check is whether a
 * one-time code arrives, and that check is free -- the server sends the mail
 * either way. What this catches is the typo class a person can see: no @, a
 * space, nothing after the dot, a bare hostname with no TLD. Anything stricter
 * starts rejecting addresses that genuinely exist (plus-tags, subdomains, new
 * TLDs), which is a far worse failure than letting an undeliverable one
 * through: one is a locked door, the other is a code that never turns up and
 * an obvious retry.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Trimmed and lower-cased. Trimming matters because a pasted address usually
 * carries a leading or trailing space, and an address that differs only by
 * whitespace is a different account as far as auth is concerned.
 *
 * Lower-casing is safe here: Supabase already stores and matches addresses
 * case-insensitively, so this only makes the client agree with the server
 * about which account is being addressed. Doing it at the boundary rather
 * than while typing keeps the field showing exactly what was typed.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Whether this is worth sending a code to. Normalises first, so a pasted
 *  " Jane@Example.com " is judged on what would actually be submitted. */
export function isValidEmail(value: string): boolean {
  return EMAIL.test(normalizeEmail(value));
}
