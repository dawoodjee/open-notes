import { AccountKeyRecord } from './keyBackup';

/**
 * Holds the "this device must adopt the account's key before it can read
 * anything" state, for the brief window between signing in and the user
 * supplying their recovery code.
 *
 * Module-level with a subscribe/snapshot pair rather than React state,
 * matching lib/auth/useProfile.ts: it is produced inside AuthContext's
 * sign-in sequence and consumed by a screen rendered from the root layout,
 * with no component ancestry between them.
 */

export interface PendingAdoption {
  record: AccountKeyRecord;
  /** Unwraps with the code, re-encrypts local notes, then connects sync. */
  complete: (recoveryCode: string) => Promise<void>;
  /** Abandons the attempt and signs back out. */
  cancel: () => Promise<void>;
}

let pending: PendingAdoption | null = null;
const listeners = new Set<() => void>();

export function setPendingAdoption(next: PendingAdoption | null): void {
  pending = next;
  listeners.forEach((l) => l());
}

export function subscribePendingAdoption(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingAdoption(): PendingAdoption | null {
  return pending;
}
