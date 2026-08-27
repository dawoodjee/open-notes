/**
 * The web half of the database-file lifecycle.
 *
 * ── WHAT CHANGED IN 13a ───────────────────────────────────────────────────
 *
 * Both functions here used to be honest no-ops, and the reason was structural:
 * the web database lived in MEMORY, so there was no file from a previous launch
 * to migrate and none to wipe. Every launch already started from the empty
 * state `wipeLocalDatabase()` exists to produce.
 *
 * `openDatabase.web.ts` now writes to OPFS, so half of that is no longer true.
 * `migrateToEncrypted` stays a no-op -- there has never been a pre-Stage-6
 * plaintext `notes.db` in a browser, because until 13a there was no browser
 * file at all, so the whole class of half-migrated-file bugs the native version
 * exists to handle is still unreachable here. `wipeLocalDatabase` is now real.
 *
 * ── WHY THIS FILE IS SEPARATE RATHER THAN A Platform.OS BRANCH ────────────
 *
 * The native file imports `@op-engineering/op-sqlite` at module scope and that
 * package does not exist on web -- the bundle dies at import, long before any
 * branch could run. Same shape as every other seam in this tree.
 */

export const LEGACY_DB_FILENAME = 'notes.db';
export const ENCRYPTED_DB_FILENAME = 'notes-v2.db';

/**
 * SQLite does not keep its state in one file. Deleting only the database and
 * leaving a `-wal` behind is how you resurrect the data you just deleted, since
 * the next open replays the log over an empty file.
 */
const COMPANIONS = ['', '-wal', '-journal'];

/**
 * Remove the local database. ASYNC ON PURPOSE -- see below.
 *
 * The native signature was `void`, and matching it here was not possible:
 * removing an OPFS entry returns a promise. Fire-and-forget was the tempting
 * shortcut and it is a real bug, not a stylistic one. Every caller in
 * `contexts/VaultContext.tsx` follows this immediately with `createLocalVault()`
 * and `initPowerSync()`, so an unawaited delete races the reopen: the reset
 * appears to work and then undoes itself, or worse, deletes the file the new
 * database has just created. That is the same failure the comment above
 * `resetLocalData` already warns about for native, arriving by a different
 * route.
 *
 * So the NATIVE signature moved to `Promise<void>` too, and all four call sites
 * await it. Native's body is still synchronous; it just returns a settled
 * promise. One signature, one calling discipline, no per-platform rule to
 * remember.
 *
 * Missing files are not an error. This runs on paths where the database may
 * never have existed -- first launch, and the recovery path where the device
 * key has vanished -- and "already absent" is the state it is trying to reach.
 */
export async function wipeLocalDatabase(): Promise<void> {
  const root = await navigator.storage?.getDirectory?.();
  if (!root) return;

  for (const suffix of COMPANIONS) {
    try {
      await root.removeEntry(`${ENCRYPTED_DB_FILENAME}${suffix}`);
    } catch (err) {
      /**
       * `NotFoundError` is the normal case and the desired end state. ANYTHING
       * ELSE IS RAISED, and that distinction is not pedantry -- it was measured.
       *
       * Calling this without closing the database first throws
       * `NoModificationAllowedError`: OPFS will not remove a file with a live
       * access handle. With a bare `catch {}` here that came back as a clean,
       * silent success -- every file still on disk, no error anywhere, and a
       * user told their local notes had been deleted when they had not. On a
       * control whose entire purpose is destroying data, failing quietly is the
       * worst available outcome, and it is invisible precisely because the
       * happy path also produces no output.
       *
       * Verified both ways: wipe-while-open now throws, and the close-then-wipe
       * order every caller uses removes the database, its WAL and its journal.
       */
      if ((err as DOMException)?.name !== 'NotFoundError') throw err;
    }
  }
}

export async function migrateToEncrypted(_encryptionKey: string): Promise<void> {
  // No pre-Stage-6 plaintext database can exist in a browser: until 13a the web
  // build had no file of any kind. See the header.
}
