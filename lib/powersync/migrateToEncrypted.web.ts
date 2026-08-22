/**
 * The web build of the Stage 6 plaintext-to-SQLCipher migration: nothing to do.
 *
 * Both functions here are honest no-ops rather than stubs waiting to be filled
 * in, and the reason is structural. `openDatabase.web.ts` opens the database in
 * MEMORY -- so on web there is no file from a previous launch to migrate, no
 * file to wipe, and no WAL to resurrect one. Every launch already starts from
 * the empty state that `wipeLocalDatabase()` exists to produce.
 *
 * The native file this shadows is the opposite of trivial: it exists because a
 * half-completed migration once bricked the app on every subsequent launch. That
 * whole class of bug is unreachable here, which is worth stating plainly so
 * nobody later "restores parity" by porting it.
 *
 * Kept as a separate file rather than a `Platform.OS` branch inside the native
 * one because the native one imports `@op-engineering/op-sqlite` at module
 * scope, and that package does not exist on web -- the bundle dies at import
 * time, long before any branch could run.
 */

export const LEGACY_DB_FILENAME = 'notes.db';
export const ENCRYPTED_DB_FILENAME = 'notes-v2.db';

export function wipeLocalDatabase(): void {
  // Nothing on disk to remove: see the note above.
}

export async function migrateToEncrypted(_encryptionKey: string): Promise<void> {
  // No previous-format database can exist in a memory-only store.
}
