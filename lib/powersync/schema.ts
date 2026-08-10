import { column, Schema, Table } from '@powersync/common';

// `id` is implicit in every PowerSync table, so it is not declared here.
// Column types are limited to text/integer/real — see
// supabase/migrations/20260806122256_notes_and_profiles.sql for how each one
// maps onto its Postgres counterpart.
export const notesTable = new Table({
  user_id: column.text, // nullable until an account claims the note (Stage 5)
  body: column.text,
  title: column.text,
  created_at: column.text, // ISO-8601 -> timestamptz
  updated_at: column.text, // ISO-8601 -> timestamptz
  is_trashed: column.integer, // 0/1 -> boolean
});

// Deliberately localOnly with no user_id and no Postgres counterpart: which note
// you had open is per-device, so syncing it would fight across devices.
export const uiStateTable = new Table(
  {
    last_opened_note_id: column.text,
    editor_scroll_offset: column.integer,
    // The two plaintext gates (Stage 6.5). Three states in one column, which
    // is worth stating explicitly because the encoding is load-bearing:
    //
    //   NULL      the gate is OFF. This is the default and the only state in
    //             which lib/plaintext/broker.ts will refuse before decrypting
    //             anything at all.
    //   'never'   on, no expiry ("Forever" in Settings).
    //   ISO-8601  on until this instant, then treated as off.
    //
    // An expiry rather than a plain boolean because a standing permission to
    // send plaintext off the device should have to be renewed deliberately.
    ai_gate_expires_at: column.text,
    api_gate_expires_at: column.text,
  },
  { localOnly: true }
);

/**
 * Destinations this device is allowed to send decrypted note text to.
 *
 * localOnly, and deliberately so: an allow-list of places your plaintext may
 * go is a per-device decision, and syncing it would let one device widen
 * another's. There is no Postgres counterpart and there should not be one.
 *
 * NOTE WHAT IS ABSENT: the bearer token. Tokens live one-per-item in
 * SecureStore (see lib/plaintext/endpoints.ts) because SecureStore's ~2KB
 * per-value cap makes a growing list in a single item a time bomb -- the same
 * cap that forced the LargeSecureStore workaround in lib/supabase/client.ts.
 * Metadata belongs in the encrypted database; only the secret needs hardware
 * backing.
 */
export const apiEndpointsTable = new Table(
  {
    name: column.text, // user-facing label; may be empty, shown as "Untitled"
    url: column.text,
    use: column.text, // 'ai' | 'api' -- which gate governs this destination
    // When the user first approved sending plaintext here. NULL means the
    // consent prompt still has to run, even if the gate is on: the toggle is
    // permission to use the feature, not blanket permission for every
    // destination someone later adds to this list.
    confirmed_at: column.text,
    created_at: column.text,
    last_used_at: column.text,
  },
  { localOnly: true }
);

/**
 * Every time plaintext left this device, and what left.
 *
 * This is what makes a standing toggle inspectable rather than a promise.
 * Written BEFORE the outbound call, so a request that fails midway still
 * leaves a record -- the interesting question is what was exposed, not what
 * succeeded.
 *
 * Stores note IDs and a byte count, never note content. Same discipline as
 * sync_issues, and for the same reason: a log of what leaked must not itself
 * leak. localOnly and never synced.
 */
export const plaintextDisclosuresTable = new Table(
  {
    occurred_at: column.text,
    gate: column.text, // 'ai' | 'api'
    note_ids: column.text, // JSON array of ids
    endpoint_id: column.text,
    purpose: column.text,
    byte_count: column.integer,
  },
  { localOnly: true }
);

// One row per note that's currently failing to sync for a *structural*
// reason (RLS rejection, a unique violation, a stale pre-Stage-5 queue entry
// referencing a dropped column) -- see lib/powersync/connector.ts. Deliberately
// localOnly: this is per-device diagnostic state, not something to sync (and
// there's nowhere on the server for it to go). A row is deleted the moment
// its note_id next uploads successfully, so this table only ever reflects
// problems that are still true right now, never history.
export const syncIssuesTable = new Table(
  {
    note_id: column.text,
    message: column.text,
    occurred_at: column.text, // ISO-8601, same convention as notes' timestamps
  },
  { localOnly: true }
);

// The "common ancestor" a 3-way merge needs: for each note, the body exactly
// as the server last had it. Updated after every successful push and every
// pull, so it always represents the last point where this device and the
// server agreed.
//
// Without it, resolving a conflict means choosing between two bodies with no
// way to tell which parts each side actually changed -- that's last-write-
// wins, and it silently discards a whole edit even when the two devices
// touched completely different paragraphs. With it, we can diff local
// against the ancestor to get *this device's edits*, then replay just those
// onto the server's current text.
//
// localOnly for the same reason ui_state is: it describes what this
// particular device last saw, so syncing it would be meaningless (and
// there's no Postgres column for it). A device with no row here simply has
// no ancestor and falls back to overwrite -- correct, since a missing
// ancestor means we've never seen a server version to diff against.
// Stage 6 note: this stores PLAINTEXT, while notes.body stores ciphertext.
// That asymmetry is deliberate, not an oversight. A 3-way merge diffs against
// the ancestor, and ciphertext has no diffable structure -- one changed
// character rewrites every subsequent byte, and a fresh nonce rewrites them
// all regardless. It is safe only because the entire local database file is
// encrypted at rest by SQLCipher, so "plaintext" here means plaintext inside
// an encrypted container.
export const noteSyncBaseTable = new Table(
  {
    note_id: column.text,
    body: column.text, // last body the server is known to have had, decrypted
    updated_at: column.text, // ISO-8601, when this ancestor was recorded
  },
  { localOnly: true }
);

export const AppSchema = new Schema({
  notes: notesTable,
  ui_state: uiStateTable,
  sync_issues: syncIssuesTable,
  note_sync_base: noteSyncBaseTable,
  api_endpoints: apiEndpointsTable,
  plaintext_disclosures: plaintextDisclosuresTable,
});

export type Database = (typeof AppSchema)['types'];
