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

export const AppSchema = new Schema({
  notes: notesTable,
});

export type Database = (typeof AppSchema)['types'];
