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
    // ISO-8601. When the PIN was last actually typed, which is not the same
    // as when the app was last opened -- the vault stays unlocked across
    // short backgrounding, so someone can use the app for weeks without ever
    // re-entering it. Drives the periodic reminder (Stage 6), because a PIN
    // you never type is a PIN you forget, and forgetting it means falling
    // back to the recovery code.
    last_pin_entry_at: column.text,
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
});

export type Database = (typeof AppSchema)['types'];
