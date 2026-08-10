/**
 * The decision rules behind the plaintext gates, with no I/O and no imports.
 *
 * Split out for one reason: scripts/verify-plaintext-gates.ts can then import
 * and run THIS FILE under Node, rather than a transcription of it. Everything
 * that touches SQLite, SecureStore or React lives in gates.ts / broker.ts;
 * everything that decides whether plaintext may be released lives here. The
 * rules are the part worth testing, and a copy of the rules in a test file is
 * a test of the copy.
 */

export type Gate = 'ai' | 'api';

/** 'never' is stored verbatim in the column; the rest become an instant. */
export type GateWindow = 30 | 90 | 365 | 'never';

export interface GateState {
  enabled: boolean;
  /** null when off, or when the window is Forever. */
  expiresAt: Date | null;
  /** True only when it was on and the window has since passed. */
  expired: boolean;
}

/**
 * Three states in one nullable column:
 *   null      off (the default, and the only state in which nothing decrypts)
 *   'never'   on, no expiry
 *   ISO-8601  on until that instant, then off
 */
export function interpretGateValue(value: string | null, now = Date.now()): GateState {
  if (!value) return { enabled: false, expiresAt: null, expired: false };
  if (value === 'never') return { enabled: true, expiresAt: null, expired: false };

  const expiresAt = new Date(value);
  // An unparseable value is treated as off rather than as forever. Failing
  // closed matters more here than tolerating a corrupt row.
  if (Number.isNaN(expiresAt.getTime())) {
    return { enabled: false, expiresAt: null, expired: false };
  }

  const expired = expiresAt.getTime() <= now;
  return { enabled: !expired, expiresAt, expired };
}

export function gateValueFor(window: GateWindow, now = Date.now()): string {
  if (window === 'never') return 'never';
  return new Date(now + window * 24 * 60 * 60 * 1000).toISOString();
}

export type DenialReason =
  | 'gate-off'
  | 'gate-expired'
  | 'unknown-endpoint'
  | 'endpoint-incomplete'
  | 'no-notes'
  | 'undecryptable'
  | 'user-declined';

/** Just the endpoint fields the decision depends on. */
export interface EndpointFacts {
  id: string;
  url: string;
  use: Gate;
  confirmedAt: string | null;
}

export type AccessDecision =
  | { allow: true; needsConsent: boolean }
  | { allow: false; denied: DenialReason };

/**
 * Everything that can refuse a request WITHOUT touching the encryption key.
 *
 * The ordering is the security property, not a style choice: if any of these
 * can refuse, they must all run before a single note is decrypted. A version
 * that decrypted first and filtered afterwards would behave identically from
 * the outside while quietly making "the gate is off" mean nothing.
 */
export function decideAccess(input: {
  gate: Gate;
  gateState: GateState;
  noteIds: string[];
  endpoint: EndpointFacts | null;
}): AccessDecision {
  const { gate, gateState, noteIds, endpoint } = input;

  if (!gateState.enabled) {
    return { allow: false, denied: gateState.expired ? 'gate-expired' : 'gate-off' };
  }
  if (noteIds.length === 0) return { allow: false, denied: 'no-notes' };
  if (!endpoint) return { allow: false, denied: 'unknown-endpoint' };
  // A destination registered under the other gate is not reachable by this
  // one. Otherwise turning on AI access would also open every API endpoint.
  if (endpoint.use !== gate) return { allow: false, denied: 'unknown-endpoint' };
  if (!endpoint.url) return { allow: false, denied: 'endpoint-incomplete' };

  return { allow: true, needsConsent: !endpoint.confirmedAt };
}
