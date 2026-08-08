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

export const AppSchema = new Schema({
  notes: notesTable,
  ui_state: uiStateTable,
  sync_issues: syncIssuesTable,
});

export type Database = (typeof AppSchema)['types'];
