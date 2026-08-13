/**
 * Holds the "this account has no recovery code yet" state, for the window
 * between signing in and the user writing one down.
 *
 * Module-level with a subscribe/snapshot pair rather than React state, exactly
 * like ./adoption.ts next door: it is produced inside AuthContext's sign-in
 * sequence and consumed by a screen rendered from the root layout, with no
 * component ancestry between them.
 *
 * WHY THIS EXISTS AT ALL. A device mints its data key on first launch, with no
 * account and no recovery code -- that's what lets someone write a note the
 * instant they open the app. But the moment an account is involved the key has
 * to be able to reach a second device, and the only thing that can carry it
 * there is the recovery code. So sign-in is where the code gets generated, and
 * sync stays disconnected until it has been confirmed: uploading notes whose
 * key exists on exactly one device, with no way off it, would be a data-loss
 * trap dressed up as a backup.
 */

export interface PendingKeySetup {
  /**
   * The account this code is being issued for.
   *
   * The screen needs it to stamp ownership onto the code (see
   * markRecoveryConfirmed), and cannot get it any other way -- it renders from
   * the root layout, with no component ancestry back to the sign-in sequence
   * that produced this object.
   */
  userId: string;
  /** Generates the code, shows it, and resumes sign-in once confirmed. */
  complete: () => Promise<void>;
  /** Abandons the attempt and signs back out. */
  cancel: () => Promise<void>;
}

let pending: PendingKeySetup | null = null;
const listeners = new Set<() => void>();

export function setPendingKeySetup(next: PendingKeySetup | null): void {
  pending = next;
  listeners.forEach((l) => l());
}

export function subscribePendingKeySetup(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingKeySetup(): PendingKeySetup | null {
  return pending;
}
