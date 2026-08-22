import { PowerSyncDatabase, TemporaryStorageOption, WASQLiteVFS } from '@powersync/web';
import type { CommonPowerSyncDatabase, Schema } from '@powersync/common';
import type { OpenOptions } from './openDatabase';

/**
 * The web database: wa-sqlite, entirely in memory, gone when the tab closes.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 *
 * Until now web had no database. `@powersync/react-native` and op-sqlite are
 * native modules, so `initPowerSync()` threw at import, VaultContext caught it,
 * and every route on web was replaced by BootFailureScreen. Adam's call
 * (2026-08-22): that screen "should never be seen by the user, there has to be
 * a way through it". A read-only error page is not a way through, so web needed
 * a real, writable database -- hence `@powersync/web`, pinned to 2.1.0 because
 * that is the last release whose peer range is satisfied by the
 * `@powersync/common@2.0.0` the native SDK already pins. 2.2.0 would drag the
 * shared core up under native's feet to make a web-only feature work.
 *
 * ── WHY IN MEMORY, WHICH IS THE INTERESTING PART ──────────────────────────
 *
 * Persisting on web means IndexedDB or OPFS, and the moment notes persist in a
 * browser the at-rest question has to be answered for real: SQLCipher does not
 * exist here, wa-sqlite's own encryption is ChaCha20 with a key that would then
 * need somewhere to live, and the only places to put it on web are readable by
 * any script on the origin. That is Stage 13's Phase 0 spike, and it is a
 * genuinely hard question.
 *
 * Memory-only sidesteps it rather than pre-empting it: nothing is written down,
 * so there is nothing at rest and no key to store. `secureStorage.web.ts` makes
 * the identical trade for the vault keys -- the two have to agree, or the
 * database would outlive the key that reads it (or worse, the reverse).
 *
 * The trade Adam accepted: a refresh is a new session with an empty database.
 * Export-then-reimport is what makes that survivable, and it lands in Stage 13.
 *
 * ── THE WORKER, AND WHY IT IS NOT OPTIONAL HERE ──────────────────────────
 *
 * `InMemoryVfs` has three configurations, and the tempting one is the third:
 * no worker at all, database hosted in the tab, queries running synchronously.
 * It is the fastest, and it was the first thing tried.
 *
 * It does not work under Metro. Running in the tab means the app bundle has to
 * import wa-sqlite's Emscripten module directly, and that module opens with
 * `var _scriptName = import.meta.url`. Metro emits a classic script rather than
 * an ES module, so the page died at parse time with `Cannot use 'import.meta'
 * outside a module` -- before any app code ran, which is the same class of dead
 * end this whole sub-phase exists to remove.
 *
 * The worker is the SDK's own answer, and the reason it ships a pre-bundled one
 * plus a `copy-assets` CLI. The worker is a real ES module served as a static
 * file from `public/@powersync/`, so it loads wa-sqlite and its wasm itself and
 * `import.meta` never enters the Metro bundle. `metro.config.js` has the other
 * half of this story.
 *
 * `enableMultiTabs: false` picks the DEDICATED worker rather than a shared one,
 * which is the honest match for a session-only database: one tab, one database,
 * cleared when that tab closes. A shared worker would silently give two tabs one
 * database and make "session" mean something different in each.
 *
 * No `encryptionKey` is passed, and that is not an oversight. Encryption at
 * rest protects bytes on a disk; these bytes never reach one.
 */

export type { OpenOptions };

export const isSessionOnlyDatabase = true;

export function openDatabase({
  schema,
  dbFilename,
}: {
  schema: Schema;
  dbFilename: string;
  encryptionKey: string;
}): CommonPowerSyncDatabase {
  return new PowerSyncDatabase({
    schema,
    database: {
      dbFilename,
      vfs: WASQLiteVFS.InMemoryVfs,
      enableMultiTabs: false,
      // Served from public/@powersync -- see the README there for how it gets
      // regenerated and why it is committed.
      worker: '/@powersync/worker.js',
      temporaryStorage: TemporaryStorageOption.MEMORY,
    },
  });
}
