import { Note, parseNoteContent } from '@/types/note';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import { AppSchema } from './schema';
import { connector } from './connector';
import { getCurrentUserId } from '@/lib/auth/currentUser';
import { getDatabaseKey } from '@/lib/crypto/vault';
import { encryptField, tryDecryptField } from '@/lib/crypto/noteCrypto';
import { ENCRYPTED_DB_FILENAME, migrateToEncrypted } from './migrateToEncrypted';
import { isSkillsFolder } from './folders';

// Note the "-v2": the encrypted database is a different file from the
// pre-Stage-6 plaintext one. See migrateToEncrypted.ts for why the format
// change gets a new filename instead of an in-place conversion.
export const DB_FILENAME = ENCRYPTED_DB_FILENAME;

/**
 * The database instance is built lazily, not at module load, and that's a
 * Stage 6 requirement rather than a style choice.
 *
 * SQLCipher needs the encryption key at open time, and that key is derived
 * from the vault's data key -- which doesn't exist until the user has entered
 * their PIN. A module-level `new PowerSyncDatabase(...)` would run on import,
 * long before any of that, so there would be no key to give it.
 */
let instance: PowerSyncDatabase | null = null;

export function getPowerSync(): PowerSyncDatabase {
  if (!instance) {
    throw new Error('PowerSync is not initialised yet -- unlock the vault first.');
  }
  return instance;
}

export function isPowerSyncReady(): boolean {
  return instance !== null;
}

/**
 * Safe to call repeatedly; only the first call does anything.
 *
 * Must run AFTER the vault is unlocked. getDatabaseKey() throws otherwise,
 * which is the behaviour we want -- opening the database unencrypted because
 * a key wasn't ready is exactly the silent failure this stage exists to
 * prevent.
 */
let initInFlight: Promise<void> | null = null;

export async function initPowerSync(): Promise<void> {
  if (instance) return;
  // Concurrent callers await the SAME init rather than starting a second one.
  // There are three call sites (VaultContext boot, unlock, and NotesLayout's
  // watch setup) and the `if (instance)` guard alone does not stop two of them
  // overlapping: `instance` isn't assigned until well after the first await,
  // so both would sail past the guard and run the migration twice.
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    // Converts a pre-Stage-6 plaintext notes.db, if one is present. SQLCipher
    // cannot open an unencrypted file, so without this every note written
    // before this stage would be unreachable on first launch.
    await migrateToEncrypted(getDatabaseKey());

    const db = new PowerSyncDatabase({
      schema: AppSchema,
      database: {
        dbFilename: DB_FILENAME,
        // Note the nesting: sqliteOptions belongs to the op-sqlite adapter's
        // open options, NOT to PowerSyncDatabase's root options. Put it at the
        // top level and TypeScript rejects it; the encryption would simply
        // never be configured.
        //
        // Whole-file encryption: SQLCipher works at the page level, so notes,
        // ui_state, sync_issues and note_sync_base are all covered by this one
        // option -- there is nothing table-specific to configure.
        sqliteOptions: {
          encryptionKey: getDatabaseKey(),
        },
      },
    });

    // Assigned only after init() resolves. Assigning first -- as this used to
    // -- meant a failed init left a half-open database in the singleton, and
    // every later getPowerSync() handed that broken object out as if it were
    // fine. Worse, the `if (instance) return` above would then report success
    // forever, so nothing could ever retry.
    await db.init();
    instance = db;

    await encryptLegacyPlaintextNotes(db);
    await purgeExpiredTrash(db);
  })();

  try {
    await initInFlight;
  } finally {
    initInFlight = null;
  }
}

/**
 * Close and forget the database so a later initPowerSync() genuinely reopens
 * it. Used by the reset-after-boot-failure path, which deletes the file out
 * from under any handle this module is still holding.
 */
export async function closePowerSync(): Promise<void> {
  const open = instance;
  instance = null;
  syncBaseTrackingStarted = false;
  if (!open) return;
  try {
    await open.close();
  } catch {
    // Best effort: the caller is about to delete the file regardless, and a
    // close that fails must not block the one escape route from a dead boot.
  }
}

// Not called from initPowerSync -- connecting is an auth-state decision
// (Phase 2 wires this to login/logout), not something that should happen
// unconditionally at app boot. The app keeps working fully offline/local-only
// without this ever being called, exactly as it did before Stage 5.
export async function connectPowerSync(): Promise<void> {
  await getPowerSync().connect(connector);
  startSyncBaseTracking();
}

let syncBaseTrackingStarted = false;

/**
 * Keeps note_sync_base (the 3-way merge's common ancestor) fresh after data
 * arrives FROM the server. The connector already updates it after every
 * successful push; this covers the other direction.
 *
 * It matters because the ancestor is supposed to mean "the last body this
 * device and the server agreed on". After a pull, local content includes
 * another device's edits -- if the ancestor still pointed at our last push,
 * the next merge would diff against it, decide the other device's changes
 * were ours, and replay them onto a server that already has them. Duplicated
 * paragraphs, from a merge that was trying to be careful.
 *
 * The rule used here is deliberately narrow so it's provable rather than
 * approximately right: only refresh when the upload queue is completely
 * empty. An empty queue means this device has no unpushed changes, so local
 * content IS server content, so local body is exactly the right ancestor. Any
 * note with a pending write is skipped entirely -- for those, the connector's
 * post-push update is the correct source, and guessing here would corrupt the
 * very state the merge depends on.
 */
function startSyncBaseTracking(): void {
  if (syncBaseTrackingStarted) return;
  syncBaseTrackingStarted = true;

  getPowerSync().registerListener({
    statusChanged: (status) => {
      if (!status.connected || status.dataFlowStatus?.uploading) return;
      void refreshSyncBaseIfSettled();
    },
  });
}

let refreshInFlight = false;

async function refreshSyncBaseIfSettled(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const pending = await getPowerSync().get<{ count: number }>(
      'SELECT count(*) as count FROM ps_crud'
    );
    if (pending.count > 0) return;

    const notes = await getPowerSync().getAll<{ id: string; body: string }>(
      'SELECT id, body FROM notes'
    );

    await getPowerSync().writeTransaction(async (tx) => {
      for (const note of notes) {
        // note.body is an envelope; the ancestor must be plaintext, because
        // the next 3-way merge diffs against it and diffing ciphertext is
        // meaningless. Skip anything that won't decrypt rather than writing
        // a corrupt ancestor -- a missing ancestor degrades to overwrite,
        // which is recoverable; a wrong one silently mangles future merges.
        const plain = tryDecryptField(note.body);
        if (!plain.ok) continue;

        const existing = await tx.getOptional<{ body: string }>(
          'SELECT body FROM note_sync_base WHERE note_id = ?',
          [note.id]
        );
        if (existing?.body === plain.text) continue;

        await tx.execute('DELETE FROM note_sync_base WHERE note_id = ?', [note.id]);
        await tx.execute(
          'INSERT INTO note_sync_base (id, note_id, body, updated_at) VALUES (?, ?, ?, ?)',
          [Crypto.randomUUID(), note.id, plain.text, new Date().toISOString()]
        );
      }
      // Notes deleted server-side leave no ancestor to keep.
      await tx.execute(
        'DELETE FROM note_sync_base WHERE note_id NOT IN (SELECT id FROM notes)'
      );
    });
  } catch {
    // Best-effort: a stale ancestor degrades merge quality, it doesn't break
    // syncing, so this must never take the sync loop down with it.
  } finally {
    refreshInFlight = false;
  }
}

/**
 * Re-encrypts any note whose body/title is still plaintext -- a note created
 * before the vault existed, never reopened through updateNoteInDB since.
 *
 * WHY THIS HAS TO RUN HERE, ONCE, RATHER THAN AS A GUARD IN EACH WRITE
 * FUNCTION BELOW: trashNoteInDB, restoreNoteInDB, setNoteHiddenFromApi and
 * claimUnownedNotes all write only their own columns, never body/title. That
 * looks harmless -- until connector.ts's uploadEntry, which uploads a row's
 * CURRENT LOCAL STATE on any queued op for it, not just the changed columns.
 * A metadata-only write on a note that's still plaintext locally forwards
 * that plaintext to Postgres as a legitimate update. This already happened
 * for real (see mvp-build-plan.md's Decisions Log, 2026-08-19).
 *
 * A per-function guard only protects the functions that remember to call it.
 * Running this once, before anything else touches the table, makes the bug
 * structurally impossible instead: by the time any UPDATE executes this
 * session, there is no plaintext left to forward, regardless of which
 * function fires next -- including ones written after this comment.
 *
 * updated_at is deliberately left untouched, same reasoning as
 * setNoteHiddenFromApi below: this changes storage representation, not the
 * note's substance, so it must not reorder the list or read as an edit.
 */
async function encryptLegacyPlaintextNotes(db: PowerSyncDatabase): Promise<void> {
  const rows = await db.getAll<{ id: string; body: string; title: string }>(
    `SELECT id, body, title FROM notes
     WHERE body NOT LIKE 'enc:v1:%' OR title NOT LIKE 'enc:v1:%'`
  );
  if (rows.length === 0) return;

  await db.writeTransaction(async (tx) => {
    for (const row of rows) {
      await tx.execute(`UPDATE notes SET body = ?, title = ? WHERE id = ?`, [
        encryptField(row.body),
        encryptField(row.title),
        row.id,
      ]);
    }
  });
}

/** How long a trashed note survives before it is destroyed for good. */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Destroy notes that have been in the trash longer than the retention window.
 *
 * WHY THIS IS CLIENT-DRIVEN AND HAS TO BE. The server can read trashed_at --
 * it is plaintext, precisely so that sync and RLS can filter on it -- so a
 * server-side cron is technically possible. It is still wrong: it would have
 * the server destroying rows it cannot read, on a schedule the client never
 * agreed to, with no way for a user holding the only copy of the key to
 * inspect what was lost. Deletion of content is a decision that belongs on the
 * side that can actually see the content.
 *
 * WHAT HAPPENS TO A DEVICE THAT HASN'T OPENED IN MONTHS: nothing, until it
 * opens -- its local copy still holds notes long past 30 days. In practice it
 * almost never has to do the work itself: whichever device swept first emitted
 * real DELETEs, and those propagate, so the stale device receives the
 * deletions on reconnect and finds nothing left to purge. This sweep is the
 * backstop for the case where NO device has opened inside the window, which is
 * also the only case where nothing has been destroyed prematurely.
 *
 * Runs at init beside the other two once-per-launch passes, and deliberately
 * after them: encryptLegacyPlaintextNotes must not spend work re-encrypting
 * notes that are about to be deleted.
 */
async function purgeExpiredTrash(db: PowerSyncDatabase): Promise<void> {
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // trashed_at IS NOT NULL is redundant against the server's check constraint
  // but not against local SQLite, which has no such constraint -- and a NULL
  // comparison would silently match nothing rather than erroring, so the guard
  // is cheaper than the debugging session.
  await db.execute(
    `DELETE FROM notes
     WHERE is_trashed = 1 AND trashed_at IS NOT NULL AND trashed_at < ?`,
    [cutoff]
  );
}

/**
 * Attach a newly-signed-in user to every local note that doesn't have an
 * owner yet -- the notes they wrote before enabling sync.
 *
 * Must run BEFORE connectPowerSync(), not after. Once connected, the first
 * sync checkpoint discards local rows the server doesn't know about, and an
 * unowned note is unknowable to the server by construction (the sync bucket
 * is `where user_id = bucket.user_id`). Claiming after connecting would race
 * that checkpoint and usually lose.
 *
 * Purely local SQL, so it only ever touches rows already on this device.
 * That's safe *because* an account switch clears local storage first (see
 * becomeAuthenticatedLocally) -- without that ordering, this same statement
 * would happily hand the previous account's notes to the new one.
 */
export async function claimUnownedNotes(userId: string): Promise<number> {
  const unowned = await getPowerSync().getAll<{ id: string }>(
    'SELECT id FROM notes WHERE user_id IS NULL'
  );
  if (unowned.length === 0) return 0;

  await getPowerSync().execute('UPDATE notes SET user_id = ? WHERE user_id IS NULL', [userId]);
  return unowned.length;
}

/**
 * The single point where stored ciphertext becomes readable app data.
 *
 * Stays synchronous -- noble's AES-GCM is sync, and making this async would
 * ripple into PowerSync's watch() callback and every consumer of it for no
 * benefit.
 */
export function mapRowToNote(row: any): Note {
  const body = tryDecryptField(row.body);
  const title = tryDecryptField(row.title);
  const decryptFailed = !body.ok || !title.ok;

  return {
    id: row.id,
    userId: row.user_id ?? null,
    body: body.text,
    title: title.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isTrashed: Boolean(row.is_trashed),
    trashedAt: row.trashed_at ?? null,
    folderId: row.folder_id ?? null,
    isHiddenFromApi: Boolean(row.is_hidden_from_api),
    // Surfaced rather than swallowed. An undecryptable note must not look
    // like an empty note: the editor would happily save over it, turning a
    // temporary key problem into permanent data loss. updateNoteInDB refuses
    // such writes independently (see there), but the UI deserves to know too.
    decryptFailed,
  };
}

/**
 * Create a note, optionally filed into a folder.
 *
 * THE ONE SECURITY-RELEVANT LINE IN HERE is the api-visibility default, so it
 * is spelled out rather than left to be inferred:
 *
 *   - Everywhere in the app, a new note is created VISIBLE to apps
 *     (is_hidden_from_api = 0). That is unchanged from Stage 6.5 and is not
 *     the permissive choice it sounds like -- the API gate itself is off by
 *     default and is the real control; this flag is a per-note exception
 *     INSIDE a permission the user has already granted.
 *
 *   - Inside Skills, the "Keep Skills visible to apps" setting decides. On (the
 *     default) matches the app-wide behaviour above; off creates the note
 *     hidden, so a user who wants skills inert until they say otherwise can
 *     have that.
 *
 * What this deliberately does NOT do is touch an existing note's visibility.
 * Moving a note into or out of Skills leaves the flag exactly as it was --
 * silently un-hiding a note somebody hid by hand is the one behaviour this
 * must never have.
 */
export async function createNoteInDB(folderId: string | null = null): Promise<Note> {
  const id = Crypto.randomUUID();
  const body = '';
  const { title } = parseNoteContent(body);
  const now = new Date().toISOString();

  const hiddenFromApi = (await isSkillsFolder(folderId))
    ? !(await getSkillsApiVisible())
    : false;

  // Stamped with the current owner at creation, NULL only when genuinely
  // signed out (those get claimed at login -- see claimUnownedNotes below).
  //
  // This is not cosmetic. Once PowerSync is connected, every local insert is
  // queued for upload immediately, and a note with a NULL user_id can never
  // satisfy the `owners insert their notes` RLS policy -- `auth.uid() = NULL`
  // is NULL, not true. The rejected op gets dropped, PowerSync treats the
  // local mutation as handed off, and the row is erased from local storage at
  // the next checkpoint because the server never echoes it back (it isn't in
  // any sync bucket). The note vanishes seconds after being created.
  const userId = getCurrentUserId();
  await getPowerSync().execute(
    `INSERT INTO notes (id, user_id, body, title, created_at, updated_at, is_trashed, trashed_at, is_hidden_from_api, folder_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [id, userId, encryptField(body), encryptField(title), now, now, hiddenFromApi ? 1 : 0, folderId]
  );

  return {
    id,
    userId,
    body,
    title,
    createdAt: now,
    updatedAt: now,
    isTrashed: false,
    trashedAt: null,
    folderId,
    isHiddenFromApi: hiddenFromApi,
  };
}

/**
 * Move a note between folders. NULL means unfiled (All Notes).
 *
 * Does not touch updated_at, and does not touch is_hidden_from_api. The first
 * for the reason setNoteHiddenFromApi gives -- filing a note is not editing
 * it, and the list is ordered by updated_at. The second because visibility is
 * the note's own property: it followed the folder once, at creation, and
 * re-deciding it here would mean moving a note could silently expose it.
 */
export async function setNoteFolder(id: string, folderId: string | null): Promise<void> {
  await getPowerSync().execute(`UPDATE notes SET folder_id = ? WHERE id = ?`, [folderId, id]);
}

/**
 * Takes PLAINTEXT and stores ciphertext. Callers (the editor) never see an
 * envelope.
 *
 * Two guards, both load-bearing:
 *
 * 1. Refuses to write over content it could not decrypt. Otherwise a locked
 *    vault or a foreign data key would present the note as empty, the editor
 *    would autosave that emptiness, and a recoverable key problem would
 *    become permanent data loss.
 *
 * 2. Returns early when the plaintext is unchanged. This is why the no-op
 *    re-save question matters: AES-GCM uses a fresh random nonce every time,
 *    so re-encrypting identical text produces different bytes. Without this
 *    check, opening a note and closing it would write new ciphertext, queue
 *    an upload, and look like a real edit to every other device. Comparing
 *    plaintext -- not ciphertext -- is the only comparison that means
 *    anything here.
 */
export async function updateNoteInDB(id: string, body: string): Promise<void> {
  const existing = await getPowerSync().getOptional<{ body: string }>(
    'SELECT body FROM notes WHERE id = ?',
    [id]
  );

  if (existing) {
    const current = tryDecryptField(existing.body);
    if (!current.ok) {
      throw new Error(
        `Refusing to overwrite note ${id}: its stored content could not be decrypted.`
      );
    }
    if (current.text === body) return;
  }

  const { title } = parseNoteContent(body);
  const now = new Date().toISOString();

  await getPowerSync().execute(
    `UPDATE notes SET body = ?, title = ?, updated_at = ? WHERE id = ?`,
    [encryptField(body), encryptField(title), now, id]
  );
}

/**
 * Soft-delete. Sets trashed_at in the SAME statement that sets is_trashed, and
 * restore clears both together -- which is what makes the pair impossible to
 * desynchronise in practice, independently of the check constraint that makes
 * it impossible in principle.
 *
 * folder_id is deliberately left alone, so restore can put the note back where
 * it came from. (The exception is a note trashed by deleting its folder: the
 * folder row is gone, so the FK's `on delete set null` unfiles it and it
 * restores to All Notes. There is no better answer -- the folder no longer
 * exists.)
 */
export async function trashNoteInDB(id: string): Promise<void> {
  const now = new Date().toISOString();
  await getPowerSync().execute(
    `UPDATE notes SET is_trashed = 1, trashed_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
}

/**
 * Hide or unhide a note from the API gate.
 *
 * DELIBERATELY DOES NOT TOUCH updated_at, unlike trash and restore above.
 * The note list is ordered by `updated_at desc`, so bumping it would send a
 * note to the top of the list every time its visibility was toggled -- and
 * changing who may read a note is not an edit to the note. Same reasoning as
 * lib/crypto/reEncrypt.ts, which leaves the timestamp alone for the same
 * reason.
 *
 * It still syncs: PowerSync records a CRUD op for any UPDATE, whatever the
 * columns. And it is safe through the merge path in connector.ts, because the
 * body is unchanged -- mergeBody sees identical plaintext on both sides and
 * returns clean, which is the no-op re-save case verify-merge-encrypted
 * already covers.
 */
export async function setNoteHiddenFromApi(id: string, hidden: boolean): Promise<void> {
  await getPowerSync().execute(`UPDATE notes SET is_hidden_from_api = ? WHERE id = ?`, [
    hidden ? 1 : 0,
    id,
  ]);
}

export async function restoreNoteInDB(id: string): Promise<void> {
  const now = new Date().toISOString();
  await getPowerSync().execute(
    `UPDATE notes SET is_trashed = 0, trashed_at = NULL, updated_at = ? WHERE id = ?`,
    [now, id]
  );
}

export async function permanentDeleteNoteInDB(id: string): Promise<void> {
  await getPowerSync().execute('DELETE FROM notes WHERE id = ?', [id]);
}

export async function emptyTrashInDB(): Promise<void> {
  await getPowerSync().execute('DELETE FROM notes WHERE is_trashed = 1');
}

export interface UiState {
  lastOpenedNoteId: string | null;
  editorScrollOffset: number;
  /** NULL = off, 'never' = no expiry, otherwise ISO-8601. See schema.ts. */
  apiGateExpiresAt: string | null;
  /** Whether a note created in Skills starts visible to apps. Defaults true. */
  skillsApiVisible: boolean;
}

const UI_STATE_COLUMNS =
  'last_opened_note_id, editor_scroll_offset, api_gate_expires_at, skills_api_visible';

/**
 * Read on its own rather than through getUiState() because createNoteInDB
 * calls it on every note creation and has no use for the other three fields.
 *
 * Absent (NULL) reads as TRUE. A device that predates this column has to
 * behave like a fresh install, and a fresh install's answer is "on" -- the
 * same value the app-wide default already produces, so the column's existence
 * changes nothing until somebody turns it off.
 */
export async function getSkillsApiVisible(): Promise<boolean> {
  const row = await getPowerSync().getOptional<{ skills_api_visible: number | null }>(
    'SELECT skills_api_visible FROM ui_state WHERE id = ?',
    ['singleton']
  );
  return row?.skills_api_visible == null ? true : row.skills_api_visible === 1;
}

export async function setSkillsApiVisible(visible: boolean): Promise<void> {
  await saveUiState({ skillsApiVisible: visible });
}

export async function getUiState(): Promise<UiState> {
  const row = await getPowerSync().getOptional<any>(
    `SELECT ${UI_STATE_COLUMNS} FROM ui_state WHERE id = ?`,
    ['singleton']
  );

  return {
    lastOpenedNoteId: row?.last_opened_note_id ?? null,
    editorScrollOffset: row?.editor_scroll_offset ?? 0,
    apiGateExpiresAt: row?.api_gate_expires_at ?? null,
    skillsApiVisible: row?.skills_api_visible == null ? true : row.skills_api_visible === 1,
  };
}

// PowerSync exposes tables as SQLite *views* (INSTEAD OF triggers over internal
// storage), which support INSERT/UPDATE/DELETE but not UPSERT — so this
// read-merge-writes rather than using ON CONFLICT.
export async function saveUiState(partial: Partial<UiState>): Promise<void> {
  await getPowerSync().writeTransaction(async (tx) => {
    const existing = await tx.getOptional<any>(
      `SELECT ${UI_STATE_COLUMNS} FROM ui_state WHERE id = ?`,
      ['singleton']
    );

    const lastOpenedNoteId =
      partial.lastOpenedNoteId ?? existing?.last_opened_note_id ?? null;
    const editorScrollOffset =
      partial.editorScrollOffset ?? existing?.editor_scroll_offset ?? 0;
    // `?? existing` would make turning the gate OFF impossible: null is the
    // "off" value, so it has to be distinguishable from "not supplied".
    const apiGateExpiresAt =
      'apiGateExpiresAt' in partial
        ? partial.apiGateExpiresAt
        : (existing?.api_gate_expires_at ?? null);
    // Same 'in partial' treatment as the gate, and for a related reason: false
    // is a meaningful value here, and `?? existing` would make turning this
    // OFF impossible.
    const skillsApiVisible =
      'skillsApiVisible' in partial
        ? partial.skillsApiVisible
        : existing?.skills_api_visible == null
          ? true
          : existing.skills_api_visible === 1;

    if (existing) {
      await tx.execute(
        `UPDATE ui_state SET last_opened_note_id = ?, editor_scroll_offset = ?,
                             api_gate_expires_at = ?, skills_api_visible = ? WHERE id = ?`,
        [
          lastOpenedNoteId,
          editorScrollOffset,
          apiGateExpiresAt,
          skillsApiVisible ? 1 : 0,
          'singleton',
        ]
      );
    } else {
      await tx.execute(
        `INSERT INTO ui_state (id, last_opened_note_id, editor_scroll_offset,
                               api_gate_expires_at, skills_api_visible)
         VALUES (?, ?, ?, ?, ?)`,
        [
          'singleton',
          lastOpenedNoteId,
          editorScrollOffset,
          apiGateExpiresAt,
          skillsApiVisible ? 1 : 0,
        ]
      );
    }
  });
}
