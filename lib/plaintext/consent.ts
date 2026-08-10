import { Endpoint } from './endpoints';

/**
 * The first-use-per-destination prompt, held module-level with a
 * subscribe/snapshot pair -- the same shape as lib/crypto/adoption.ts and
 * lib/crypto/keySetup.ts, and for the same reason: it is raised from inside a
 * plain async function with no component around it, and consumed by a screen
 * rendered from the root layout.
 *
 * Asked once per endpoint, not once per request. Prompting on every call
 * trains people to tap through it, which is worse than not asking; prompting
 * never means the toggle silently authorises hosts added long afterwards.
 * Editing an endpoint's URL clears the consent (see endpoints.ts).
 */

export interface PendingConsent {
  endpoint: Endpoint;
  purpose: string;
  noteCount: number;
  approve: () => void;
  deny: () => void;
}

let pending: PendingConsent | null = null;
const listeners = new Set<() => void>();

export function setPendingConsent(next: PendingConsent | null): void {
  pending = next;
  listeners.forEach((l) => l());
}

export function subscribePendingConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingConsent(): PendingConsent | null {
  return pending;
}

/** Resolves true if the user allowed this destination. */
export function askForConsent(
  endpoint: Endpoint,
  purpose: string,
  noteCount: number
): Promise<boolean> {
  return new Promise((resolve) => {
    setPendingConsent({
      endpoint,
      purpose,
      noteCount,
      approve: () => {
        setPendingConsent(null);
        resolve(true);
      },
      deny: () => {
        setPendingConsent(null);
        resolve(false);
      },
    });
  });
}
