import { isSQLCipher, open } from '@op-engineering/op-sqlite';

/**
 * One-time conversion of a pre-Stage-6 plaintext database into an encrypted
 * one.
 *
 * WHY THIS HAS TO EXIST: SQLCipher cannot open an unencrypted file. Enabling
 * encryption without this step doesn't produce an error you'd notice -- it
 * produces an app that looks freshly installed, with every note written
 * before the upgrade sitting in a file nothing can read. For a signed-in user
 * that's recoverable (the notes are in Postgres). For a signed-out user the
 * local copy is the ONLY copy, so it would be permanent data loss.
 *
 * WHY THE FILENAME CHANGES rather than the file being converted in place:
 * the conversion writes a second file, and swapping it over the original
 * would need a filesystem rename that neither op-sqlite nor this project's
 * dependencies expose. Giving the encrypted era its own filename sidesteps
 * that entirely -- and is self-documenting about the format change, which a
 * silently-replaced notes.db would not be.
 */

export const LEGACY_DB_FILENAME = 'notes.db';
export const ENCRYPTED_DB_FILENAME = 'notes-v2.db';

/**
 * Delete the encrypted database outright, without needing its key.
 *
 * Used for exactly one thing: discarding a v1 vault's database when the vault
 * itself can no longer be opened. A v1 vault wrapped its keys under a 6-digit
 * PIN, and the PIN screens no longer exist, so there is no way to derive the
 * SQLCipher key for that file -- it is unreadable by construction and keeping
 * it would just be a stranded blob taking up space.
 *
 * The reason this works without a key: SQLCipher defers key verification to
 * the first read, so open() succeeds on any file. It's the query that would
 * fail with "file is not a database", and we never run one.
 */
export function wipeLocalDatabase(): void {
  for (const name of [ENCRYPTED_DB_FILENAME, LEGACY_DB_FILENAME]) {
    try {
      open({ name }).delete();
    } catch {
      // Already absent, which is the desired end state anyway.
    }
  }
}

export async function migrateToEncrypted(encryptionKey: string): Promise<void> {
  // The single most important line in this file.
  //
  // SQLCipher is a COMPILE-TIME option (`"op-sqlite": { "sqlcipher": true }`
  // in package.json, read by op-sqlite.podspec). Without it the binary links
  // stock SQLite, which accepts an encryptionKey and quietly ignores it --
  // the app would run perfectly while storing every note in the clear. That
  // failure is invisible from JavaScript, so it gets asserted here rather
  // than discovered by reading a database file six months from now.
  if (!isSQLCipher()) {
    throw new Error(
      'This build does not include SQLCipher. Add "op-sqlite": { "sqlcipher": true } ' +
        'to package.json and rebuild the native app (pod install + expo run:ios). ' +
        'Refusing to continue, because the database would be stored unencrypted.'
    );
  }

  let legacy: ReturnType<typeof open>;
  try {
    // Deliberately opened with NO key: we're asking "is there a readable
    // plaintext database here?".
    legacy = open({ name: LEGACY_DB_FILENAME });
  } catch {
    // Can't even open it -- nothing to migrate.
    return;
  }

  try {
    let tableCount = 0;
    try {
      const result = await legacy.execute(
        `SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'`
      );
      tableCount = Number(result.rows?.[0]?.count ?? 0);
    } catch {
      // "file is not a database" -- it's already encrypted, or it's a file we
      // shouldn't touch. Either way, leave it alone.
      return;
    }

    if (tableCount === 0) {
      // open() creates the file if it's missing, so an empty database here
      // means there was nothing before this call. Delete the file we just
      // brought into existence rather than leaving a stray plaintext artifact
      // next to the encrypted one.
      legacy.delete();
      return;
    }

    // `PRAGMA database_list` reports the absolute path SQLite resolved for
    // `main`. That's how the destination path is derived without needing a
    // filesystem module -- op-sqlite chooses the directory, and this asks it
    // where that turned out to be.
    const dbList = await legacy.execute('PRAGMA database_list');
    const mainPath = String(dbList.rows?.find((r: any) => r.name === 'main')?.file ?? '');
    if (!mainPath) {
      throw new Error('Could not determine the database path for migration.');
    }
    const directory = mainPath.slice(0, mainPath.lastIndexOf('/'));
    const targetPath = `${directory}/${ENCRYPTED_DB_FILENAME}`;

    // The key is hex from getDatabaseKey(), so it contains no quotes to
    // escape. ATTACH does not accept bound parameters for KEY, hence the
    // interpolation -- safe only because of that guarantee.
    if (!/^[0-9a-f]+$/.test(encryptionKey)) {
      throw new Error('Refusing to interpolate a non-hex encryption key into SQL.');
    }

    await legacy.execute(`ATTACH DATABASE '${targetPath}' AS encrypted KEY '${encryptionKey}'`);
    // sqlcipher_export copies the ENTIRE database -- schema and all rows,
    // including PowerSync's internal ps_data__*, ps_crud, ps_buckets and
    // ps_oplog tables. Hand-copying just the `notes` rows would silently
    // discard the sync state, so a queued-but-unsynced edit would vanish.
    await legacy.execute(`SELECT sqlcipher_export('encrypted')`);
    await legacy.execute('DETACH DATABASE encrypted');

    // Only now is the plaintext original expendable. Ordering matters: if
    // anything above threw, the old file is still intact and the next launch
    // retries from a clean state.
    legacy.delete();
  } finally {
    try {
      legacy.close();
    } catch {
      // delete() already closed it in the success path.
    }
  }
}
