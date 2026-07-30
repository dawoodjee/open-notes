import { column, Schema, Table } from '@powersync/common';

export const notesTable = new Table({
  body: column.text,
  title: column.text,
  created_at: column.text,
  updated_at: column.text,
  is_trashed: column.integer,
  trashed_at: column.text,
  version: column.integer,
});

export const uiStateTable = new Table(
  {
    last_opened_note_id: column.text,
    editor_scroll_offset: column.integer,
  },
  { localOnly: true }
);

export const AppSchema = new Schema({
  notes: notesTable,
  ui_state: uiStateTable,
});

export type Database = (typeof AppSchema)['types'];
