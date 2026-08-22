import { PowerSyncDatabase } from '@powersync/react-native';
import type { CommonPowerSyncDatabase } from '@powersync/common';
import type { Schema } from '@powersync/common';

/**
 * Constructing the database is the one part of `db.ts` that is genuinely
 * platform-specific, so it is the only part that gets split.
 *
 * `openDatabase.web.ts` sits beside this file and Metro picks it on web. Every
 * other line in `db.ts` -- the SQL, the merge logic, the trash sweep -- is
 * identical on both platforms and stays in one file, which is the point of
 * cutting the seam here rather than forking the module.
 *
 * The return type is `CommonPowerSyncDatabase` (the interface both SDKs
 * implement) rather than either SDK's concrete class, because `db.ts` holds the
 * result in a module-level singleton and that singleton has to be describable
 * without naming a package that only exists on one platform.
 */

export interface OpenOptions {
  schema: Schema;
  dbFilename: string;
  /** Hex, from the vault. SQLCipher takes it at open time -- there is no way
   *  to supply it later, which is why the vault must be unlocked first. */
  encryptionKey: string;
}

/**
 * True when the database this platform opens does not survive the process.
 * Native persists; web does not. Exported so the UI can say so out loud.
 */
export const isSessionOnlyDatabase = false;

export function openDatabase({
  schema,
  dbFilename,
  encryptionKey,
}: OpenOptions): CommonPowerSyncDatabase {
  return new PowerSyncDatabase({
    schema,
    database: {
      dbFilename,
      // Note the nesting: sqliteOptions belongs to the op-sqlite adapter's
      // open options, NOT to PowerSyncDatabase's root options. Put it at the
      // top level and TypeScript rejects it; the encryption would simply
      // never be configured.
      //
      // Whole-file encryption: SQLCipher works at the page level, so notes,
      // ui_state, sync_issues and note_sync_base are all covered by this one
      // option -- there is nothing table-specific to configure.
      sqliteOptions: { encryptionKey },
    },
  });
}
