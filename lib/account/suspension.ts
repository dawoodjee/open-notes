import { useSyncExternalStore } from 'react';

/**
 * Local overrides on top of the synced `account_deletions` row (Stage 15b).
 *
 * The row is the source of truth, but it arrives through SYNC, and a suspended
 * device is by definition not syncing. So there are two moments when this
 * device knows something the row does not show yet:
 *
 *   - it has just REQUESTED deletion -- the row has not synced down yet, but
 *     the device must suspend now, not in a few seconds;
 *   - it has just CANCELLED -- the server row is gone, but the local copy stays
 *     until sync resumes and removes it, and sync only resumes if this device
 *     stops treating itself as suspended.
 *
 * No imports, on purpose: lib/powersync/db.ts consults this before connecting,
 * and lib/account/deletion.ts depends on db.ts. Keeping the shared state here
 * is what stops that being an import cycle.
 */

/**
 * Where the last signed-in account id is kept (see lib/account/deletion.ts).
 * Here rather than there so lib/auth/logout.ts can clear it without importing
 * deletion.ts, which imports logout.ts.
 */
export const LAST_USER_KEY = 'notes.account.lastUserId';

/**
 * This device's own record that it requested deletion, persisted.
 *
 * WHY THE SYNCED ROW IS NOT ENOUGH. A device that requests deletion suspends at
 * once -- disconnecting before its own pending row has synced down. The first
 * version kept "I just requested" only in memory, so after a restart the gate
 * found no row, CONNECTED and synced (uploads included), received the row, and
 * only then suspended. Seen on the dev stack as a /sync/stream request at boot.
 * Persisting it means a suspended device knows it is suspended before it
 * touches the network.
 */
export const PENDING_KEY = 'notes.account.pendingDeletion';

/**
 * Set when this device erases itself because its account was purged; cleared
 * when the person dismisses the notice. Persisted because the notice is the
 * ONLY explanation they get for their notes disappearing -- and in the first
 * version it lived in memory, so an app closed right after erasing (found in
 * the dev-stack run, where a reload did exactly that) showed nothing at all.
 */
export const ERASED_NOTICE_KEY = 'notes.account.erasedNotice';

export interface Pending {
  requestedAt: string;
  purgeAfter: string;
}

interface State {
  /** Set the moment a request succeeds, before the row syncs down. */
  requested: Pending | null;
  /** Set the moment a cancel succeeds, until sync removes the local row. */
  cancelled: boolean;
  /** Set when this device erased itself because its account was purged. */
  erasedNotice: boolean;
}

let state: State = { requested: null, cancelled: false, erasedNotice: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getSuspensionOverrides(): State {
  return state;
}

export function useSuspensionOverrides(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

export function markRequested(pending: Pending) {
  set({ requested: pending, cancelled: false });
}

export function markCancelled() {
  set({ requested: null, cancelled: true });
}

/** Sync has caught up: the local row is gone, so the override has done its job. */
export function clearCancelled() {
  if (state.cancelled) set({ cancelled: false });
}

export function markErased() {
  set({ requested: null, cancelled: false, erasedNotice: true });
}

export function dismissErasedNotice() {
  set({ erasedNotice: false });
}

/**
 * Is this device suspended, given what the local row says?
 *
 * Pure so the three-way logic -- synced row, just-requested, just-cancelled --
 * is testable without a database.
 */
export function resolvePending(localRow: Pending | null, overrides: State): Pending | null {
  if (overrides.cancelled) return null;
  return overrides.requested ?? localRow;
}
