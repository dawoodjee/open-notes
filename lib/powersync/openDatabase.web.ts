import { PowerSyncDatabase, WASQLiteVFS } from '@powersync/web';
import type { CommonPowerSyncDatabase, Schema } from '@powersync/common';
import type { OpenOptions } from './openDatabase';

/**
 * The web database: wa-sqlite on OPFS, encrypted, and it survives the tab.
 *
 * ── WHAT CHANGED IN 13a, AND WHY THE OLD ANSWER WAS THE RIGHT ONE ─────────
 *
 * Until now this opened an in-memory database that was gone on refresh. That
 * was deliberate: persisting on web means answering the at-rest question for
 * real, and memory-only sidestepped it rather than pre-empting it -- nothing
 * written down, so nothing at rest and no key to store.
 *
 * Stage 13's Phase 0 spike answered it (`dev-docs/web-at-rest-findings.md`),
 * and the answer corrected the premise the whole stage was written on:
 * `@powersync/web` DOES ship whole-file encryption. It takes an `encryptionKey`
 * and applies it as `PRAGMA key` against a **SQLite3MultipleCiphers** build of
 * wa-sqlite (ChaCha20), which is the same CLASS of protection SQLCipher gives
 * us natively -- not a field-level workaround.
 *
 * ── WHY OPFSCoopSyncVFS AND NOT THE INDEXEDDB DEFAULT ─────────────────────
 *
 * Two reasons that happen to agree, which is rare enough to just take.
 *
 * `vfs.js` routes ONLY `IDBBatchAtomicVFS` through the async module factory, so
 * with encryption on it pulls `mc-wa-sqlite-async.wasm` -- 2.50 MB. Every OPFS
 * VFS uses the sync factory and `mc-wa-sqlite.wasm`, 1.31 MB. Half the payload
 * for a decision that is otherwise invisible to the user.
 *
 * And OPFSCoopSync is the SDK's own recommendation for multi-tab and Safari,
 * which is the case IndexedDB handles worse anyway.
 *
 * ── ENCRYPTION IS NOT OPTIONAL HERE ───────────────────────────────────────
 *
 * Adam's call, 2026-08-25: mandatory. `db.ts` has always passed the key in --
 * this file simply ignored it -- so the guard below is what makes "mandatory"
 * structural rather than a comment.
 *
 * The reason it has to be a throw and not a fallback is `note_sync_base`. That
 * table stores the last body the server was known to have, in PLAINTEXT, for
 * every note ever edited, and `schema.ts` justifies it explicitly on the
 * grounds that the whole database file is encrypted at rest. Open unencrypted
 * and that sentence silently becomes false -- not a metadata leak, full note
 * plaintext sitting in browser storage. Mirrors the native discipline where
 * `getDatabaseKey()` throwing is PREFERRED over opening unencrypted.
 *
 * ── THE WORKER, AND WHY IT IS NOT OPTIONAL ────────────────────────────────
 *
 * `InMemoryVfs` could in principle run in the tab with no worker at all. It
 * does not work under Metro: the app bundle would have to import wa-sqlite's
 * Emscripten module directly, and that module opens with
 * `var _scriptName = import.meta.url`. Metro emits a classic script, so the
 * page died at parse time with `Cannot use 'import.meta' outside a module`.
 *
 * The worker is the SDK's own answer and the reason it ships a pre-bundled one
 * plus a `copy-assets` CLI: it is a real ES module served as a static file from
 * `public/@powersync/`, so it loads wa-sqlite and its wasm itself and
 * `import.meta` never enters the Metro bundle. `metro.config.js` has the other
 * half. NOTE that `npm run powersync:assets` had to stop pruning `mc-*` for any
 * of the above to work -- that prune was correct for the memory-only build and
 * would now silently remove the only wasm that can decrypt anything.
 *
 * `enableMultiTabs: false` keeps one dedicated worker per tab. Multi-tab is a
 * later question; OPFSCoopSync is chosen so that answering it does not mean
 * changing the storage format underneath existing users.
 */

export type { OpenOptions };

export const isSessionOnlyDatabase = false;

export function openDatabase({
  schema,
  dbFilename,
  encryptionKey,
}: {
  schema: Schema;
  dbFilename: string;
  encryptionKey: string;
}): CommonPowerSyncDatabase {
  if (!encryptionKey) {
    throw new Error(
      'Refusing to open the web database without an encryption key. ' +
        'See lib/powersync/openDatabase.web.ts -- note_sync_base holds note plaintext.'
    );
  }

  /**
   * Ask the browser to stop treating this as disposable.
   *
   * Origin storage is evictable under pressure by default -- confirmed
   * first-hand during Stage 13's re-verification, where `persisted()` returned
   * false. For an offline-first app that is a data-loss path that has nothing
   * to do with encryption: notes that never synced would simply be gone.
   *
   * Deliberately not awaited, and deliberately not checked. Requesting it needs
   * no result to be worth doing, and a database open must not wait on a
   * permission heuristic.
   *
   * MEASURED, so nobody re-debugs it: on a bare `localhost` origin Chrome
   * REFUSES this -- `persist()` resolves `false` and `persisted()` stays false,
   * even called by hand from the console. That is policy, not a bug here.
   * Chrome grants persistence on engagement signals: an installed PWA, a
   * bookmark, or repeated use. So this is expected to start returning true once
   * the PWA slice of Stage 13 lands and the app is installable, and until then
   * a dev build genuinely is evictable.
   */
  void navigator.storage?.persist?.().catch(() => {});

  return new PowerSyncDatabase({
    schema,
    database: {
      dbFilename,
      vfs: WASQLiteVFS.OPFSCoopSyncVFS,
      enableMultiTabs: false,
      // Served from public/@powersync -- see the README there.
      worker: '/@powersync/worker.js',
      encryptionKey,
    },
  });
}
