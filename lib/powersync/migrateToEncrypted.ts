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

/**
 * Delete a database AND its write-ahead log, which is not the same thing.
 *
 * op-sqlite's delete() removes the main `.db` file and leaves `-wal` and
 * `-shm` sitting next to it. In WAL mode most recent content lives in the log,
 * not the main file, so the next open() -- which recreates the main file --
 * finds a matching log and replays it. The database comes back from the dead.
 *
 * That is not a hypothetical. It is precisely how the blank-screen bug worked:
 * the Stage 6 migration exported notes.db into notes-v2.db and deleted the
 * original, the orphaned WAL resurrected it on the next launch, the migration
 * saw a plaintext database again and re-ran the export into an already-
 * populated encrypted file, and threw `table ps_migration already exists`
 * before the note UI could mount. Every launch after that did the same thing.
 *
 * `PRAGMA journal_mode = DELETE` is the fix: switching out of WAL checkpoints
 * the log into the main file and REMOVES the -wal and -shm files. Only then is
 * delete() actually deleting the whole database.
 */
async function deleteDatabaseAndLog(name: string, encryptionKey?: string): Promise<void> {
  try {
    const db = open(encryptionKey ? { name, encryptionKey } : { name });
    try {
      await db.execute('PRAGMA journal_mode = DELETE');
    } catch {
      // An unreadable file has no log worth checkpointing; delete() still
      // removes the main file below, which is the best available outcome.
    }
    db.delete();
  } catch {
    // Nothing there to delete.
  }
}

/**
 * Does the encrypted database already exist with a schema in it?
 *
 * Opened with the key and immediately closed, so PowerSync gets the file to
 * itself afterwards. A `false` covers three cases that all mean the same
 * thing here -- no file, an empty file, or a file this key cannot open -- and
 * in every one of them running the migration is the right next move.
 */
async function encryptedDatabaseHasTables(encryptionKey: string): Promise<boolean> {
  let db: ReturnType<typeof open> | null = null;
  try {
    db = open({ name: ENCRYPTED_DB_FILENAME, encryptionKey });
    // Any query is also the key check: SQLCipher defers verification to the
    // first read, so a wrong key surfaces here as "file is not a database".
    const result = await db.execute(
      `SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'`
    );
    return Number(result.rows?.[0]?.count ?? 0) > 0;
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // Nothing to close.
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

  // Has this already been done? Asked FIRST, and the ordering is the fix for a
  // boot failure that could not be escaped from inside the app.
  //
  // The export below is not idempotent: sqlcipher_export copies the whole
  // schema, so running it a second time into an already-populated encrypted
  // database throws `table ps_migration already exists`. That was survivable
  // only as long as the legacy file was always deleted afterwards -- and if
  // the process died between the export and that delete (or the delete simply
  // didn't take), both files were left on disk and EVERY subsequent launch
  // re-entered the migration, threw, and never reached the note UI. A
  // permanent, self-inflicted brick from a single interrupted launch.
  //
  // So: an encrypted database that already has tables means the migration has
  // run. There is nothing to move, and the plaintext leftover is exactly that
  // -- a leftover, frozen at the moment of the original export, which the app
  // has not written to since.
  if (await encryptedDatabaseHasTables(encryptionKey)) {
    await deleteDatabaseAndLog(LEGACY_DB_FILENAME);
    return;
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
      // means there was nothing before this call. Drop out of WAL first so the
      // -wal and -shm go with it -- see deleteDatabaseAndLog.
      await legacy.execute('PRAGMA journal_mode = DELETE');
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
    //
    // Out of WAL before deleting, so no -wal survives to resurrect the file on
    // the next launch. This exact omission is what bricked the app once.
    await legacy.execute('PRAGMA journal_mode = DELETE');
    legacy.delete();
  } finally {
    try {
      legacy.close();
    } catch {
      // delete() already closed it in the success path.
    }
  }
}
