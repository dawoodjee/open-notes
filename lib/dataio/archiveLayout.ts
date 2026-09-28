import { htmlToMarkdown, type MarkdownResult } from './htmlToMarkdown';

/**
 * Where everything goes inside the zip, and how a zip's contents map back onto
 * folders. Pure: no database, no filesystem, no zip library -- so every rule
 * below has a test, and the parts that touch the device stay thin.
 */

/** Hidden file at the root of every zip WE write. See `buildImportTree`. */
export const EXPORT_MARKER = '.notes-export.json';

/** The directory trashed notes are written under, and read back from. */
export const TRASH_DIR = 'Recently Deleted';

export interface LayoutFolder {
  id: string;
  name: string;
  parentId: string | null;
  includeInNotes: boolean;
}

export interface LayoutNote {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  isTrashed: boolean;
  decryptFailed?: boolean;
}

export type ExportScope =
  | { kind: 'everything' }
  | { kind: 'allNotes' }
  | { kind: 'folder'; folderId: string };

export interface ExportPlan {
  /** Zip entries. A path ending in `/` is an (empty) directory. */
  entries: { path: string; content: string }[];
  noteCount: number;
  trashedCount: number;
  /** Notes left out, with why. Never silent. */
  skipped: { title: string; reason: string }[];
  /** Notes whose formatting partly exported as plain text, and which tags. */
  simplified: { title: string; tags: string[] }[];
}

// ─── Names ────────────────────────────────────────────────────────────────

const MAX_NAME = 100;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A folder or note title as a filename that works on every platform a zip can
 * be opened on.
 *
 * Titles are arbitrary user text. What that has to survive, each in turn:
 *   - `/` and `\` would create directories; `: * ? " < > |` are illegal on
 *     Windows; control characters are illegal nearly everywhere -> `-`.
 *   - trailing dots and spaces are silently stripped by Windows, which would
 *     make "Notes." and "Notes" collide after unzipping -> trimmed here, first.
 *   - CON, NUL, COM1 and friends cannot be filenames on Windows at all.
 *   - 255 BYTES is the usual limit and a title can be long and multi-byte ->
 *     capped at 100 characters, cut on code points so an emoji is never split.
 *   - an empty result -> the fallback.
 */
export function safeName(raw: string, fallback: string): string {
  let name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  name = Array.from(name).slice(0, MAX_NAME).join('');
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) return fallback;
  if (WINDOWS_RESERVED.test(name)) return name + '_';
  return name;
}

/**
 * First free "Name", "Name (2)", "Name (3)"… Case-insensitive, because the
 * default filesystems on macOS and Windows are: "Notes.md" and "notes.md" in
 * one folder would silently overwrite each other on unzip.
 */
export function uniqueName(name: string, taken: Set<string>, suffix = ''): string {
  let candidate = name + suffix;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})${suffix}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ─── Export ───────────────────────────────────────────────────────────────

export function planExport(
  folders: LayoutFolder[],
  notes: LayoutNote[],
  scope: ExportScope,
  exportedAt: string,
  /**
   * Markdown already converted, by note id. The export job converts note by
   * note with a yield between each, so a large export does not freeze the UI;
   * it passes the results here rather than having them converted again in one
   * uninterrupted block. Absent (as in the tests), notes are converted inline.
   */
  converted?: Map<string, MarkdownResult>
): ExportPlan {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenOf = new Map<string | null, LayoutFolder[]>();
  for (const f of folders) {
    const key = f.parentId && byId.has(f.parentId) ? f.parentId : null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), f]);
  }

  // The subtree a "folder" scope covers, and the folders "All Notes" hides.
  const subtree = new Set<string>();
  if (scope.kind === 'folder') {
    const walk = (id: string) => {
      subtree.add(id);
      for (const c of childrenOf.get(id) ?? []) walk(c.id);
    };
    walk(scope.folderId);
  }
  const excluded = new Set(folders.filter((f) => !f.includeInNotes).map((f) => f.id));

  const inScope = (note: LayoutNote): boolean => {
    if (note.isTrashed) return scope.kind === 'everything';
    if (scope.kind === 'everything') return true;
    if (scope.kind === 'folder') return !!note.folderId && subtree.has(note.folderId);
    // "All Notes" means what the All Notes list shows: Include-in-Notes is
    // evaluated on the note's OWN folder, not inherited (see Stage 10).
    return note.folderId === null || !excluded.has(note.folderId);
  };

  // Directory names are assigned once per folder, deduplicated among siblings.
  // The trash directory's name is reserved at the root so a user folder
  // literally called "Recently Deleted" cannot merge into it.
  const dirName = new Map<string, string>();
  const rootTaken = new Set<string>();
  const hasTrash = scope.kind === 'everything' && notes.some((n) => n.isTrashed);
  if (hasTrash) rootTaken.add(TRASH_DIR.toLowerCase());
  const assign = (parentKey: string | null, taken: Set<string>) => {
    const kids = [...(childrenOf.get(parentKey) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const f of kids) {
      dirName.set(f.id, uniqueName(safeName(f.name, 'Untitled folder'), taken));
      assign(f.id, new Set());
    }
  };
  assign(null, rootTaken);

  /** A folder's path inside the zip, relative to the scope's top. */
  const pathOf = (folderId: string | null): string => {
    const parts: string[] = [];
    let current = folderId ? byId.get(folderId) : undefined;
    while (current) {
      parts.unshift(dirName.get(current.id)!);
      // A folder scope's top folder is the zip's top directory; stop above it.
      if (scope.kind === 'folder' && current.id === scope.folderId) break;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return parts.length ? parts.join('/') + '/' : '';
  };

  const plan: ExportPlan = { entries: [], noteCount: 0, trashedCount: 0, skipped: [], simplified: [] };
  const takenIn = new Map<string, Set<string>>(); // directory path -> filenames used
  const dirs = new Set<string>();
  const addDir = (path: string) => {
    // Every ancestor too, so the zip's structure is explicit even when empty.
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/');
  };

  for (const note of notes) {
    if (!inScope(note)) continue;
    if (note.decryptFailed) {
      // Exporting an undecryptable note as an empty file would look exactly
      // like the note being empty -- a lie in the one place a user checks.
      plan.skipped.push({ title: note.title || 'Unreadable note', reason: 'could not be decrypted on this device' });
      continue;
    }

    let dir = pathOf(note.folderId);
    if (note.isTrashed) dir = `${TRASH_DIR}/` + dir;

    const { markdown, unmappedTags } = converted?.get(note.id) ?? htmlToMarkdown(note.body);
    const taken = takenIn.get(dir) ?? new Set<string>();
    takenIn.set(dir, taken);
    const file = uniqueName(safeName(note.title, 'Untitled'), taken, '.md');

    if (dir) addDir(dir);
    plan.entries.push({ path: dir + file, content: markdown });
    if (unmappedTags.length) plan.simplified.push({ title: note.title, tags: unmappedTags });
    if (note.isTrashed) plan.trashedCount++;
    else plan.noteCount++;
  }

  // Folders in scope that ended up with no notes still exist as directories,
  // so an export -> import round trip keeps them.
  for (const f of folders) {
    if (scope.kind === 'folder' && !subtree.has(f.id)) continue;
    if (scope.kind === 'allNotes' && excluded.has(f.id)) continue;
    addDir(pathOf(f.id));
  }

  plan.entries.unshift(
    { path: EXPORT_MARKER, content: JSON.stringify({ app: 'notes', format: 1, exportedAt }) + '\n' },
    ...[...dirs].sort().map((path) => ({ path, content: '' }))
  );
  return plan;
}

// ─── Import ───────────────────────────────────────────────────────────────

export interface ImportFile {
  /** The filename without its extension -- a fallback title for foreign files. */
  stem: string;
  path: string;
  text: string;
}

export interface ImportDir {
  name: string;
  files: ImportFile[];
  dirs: ImportDir[];
}

export interface ImportTree {
  root: ImportDir;
  /** Everything under a top-level "Recently Deleted", headed for the trash. */
  trash: ImportFile[];
  /** Entries that were not notes, with why. Reported, not silently dropped. */
  ignored: { path: string; reason: string }[];
  /** True when this zip is one of ours -- see EXPORT_MARKER. */
  fromThisApp: boolean;
}

const NOTE_EXTENSIONS = /\.(md|markdown|txt)$/i;

/**
 * A zip's entries as a folder tree.
 *
 * ── UNWRAPPING (Adam, 2026-09-28 — see the Decisions Log) ─────────────────
 *
 * Zip tools often add one extra top-level directory -- zipping a folder called
 * "MyExport" gives a zip whose only entry is "MyExport/". So while the root
 * holds no notes and exactly one directory, the root moves down into it.
 *
 * ONLY at the top. A note-less folder anywhere else is real structure
 * (`Work › Projects › Q3`, notes only in Q3) and is kept.
 *
 * And never below our marker. Exporting a single folder writes a zip whose
 * root is just `Work/`, which by shape is indistinguishable from a wrapper --
 * so our zips carry EXPORT_MARKER at their true root, and unwrapping stops at
 * the directory holding it.
 */
export function buildImportTree(entries: { path: string; text: string | null }[]): ImportTree {
  const root: ImportDir = { name: '', files: [], dirs: [] };
  const ignored: ImportTree['ignored'] = [];
  let markerDir: string | null = null;

  const dirAt = (segments: string[]): ImportDir => {
    let node = root;
    for (const seg of segments) {
      let next = node.dirs.find((d) => d.name === seg);
      if (!next) {
        next = { name: seg, files: [], dirs: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    return node;
  };

  for (const entry of entries) {
    const segments = entry.path
      .replace(/\\/g, '/')
      .split('/')
      .filter((s) => s && s !== '.' && s !== '..');
    if (!segments.length) continue;
    const isDir = entry.path.endsWith('/') || entry.text === null;
    const name = segments[segments.length - 1];

    // macOS's resource-fork shadow tree, and the hidden files it scatters.
    if (segments[0] === '__MACOSX') continue;
    if (!isDir && name === EXPORT_MARKER) {
      markerDir = segments.slice(0, -1).join('/');
      continue;
    }
    if (segments.some((s) => s.startsWith('.'))) continue;

    if (isDir) {
      dirAt(segments);
      continue;
    }
    if (!NOTE_EXTENSIONS.test(name)) {
      ignored.push({ path: segments.join('/'), reason: 'not a Markdown or text file' });
      continue;
    }
    dirAt(segments.slice(0, -1)).files.push({
      stem: name.replace(NOTE_EXTENSIONS, ''),
      path: segments.join('/'),
      text: (entry.text ?? '').replace(/^﻿/, ''),
    });
  }

  // Unwrap from the top -- see the header.
  let top = root;
  let topPath = '';
  while (top.files.length === 0 && top.dirs.length === 1 && topPath !== markerDir) {
    top = top.dirs[0];
    topPath = topPath ? `${topPath}/${top.name}` : top.name;
  }

  const trash: ImportFile[] = [];
  const trashDir = top.dirs.find((d) => d.name === TRASH_DIR);
  if (trashDir) {
    const collect = (d: ImportDir) => {
      trash.push(...d.files);
      d.dirs.forEach(collect);
    };
    collect(trashDir);
    top = { ...top, dirs: top.dirs.filter((d) => d !== trashDir) };
  }

  return { root: top, trash, ignored, fromThisApp: markerDir !== null };
}

/**
 * A foreign Markdown file whose title lives only in its filename.
 *
 * Obsidian and friends name the file after the note and often do not repeat
 * that name in the body. Since this app derives a note's title from its first
 * line, such a note would otherwise be titled after whatever sentence happens
 * to come first. So the filename is added as a heading -- unless the body
 * already starts with it.
 *
 * Only for FOREIGN zips. Our own files already begin with their title, and the
 * filename is a sanitised, possibly shortened copy of it, so comparing the two
 * would misfire and duplicate titles on every round trip.
 */
export function withTitleHeading(markdown: string, stem: string): string {
  const firstLine = markdown.split('\n').find((l) => l.trim())?.trim() ?? '';
  const firstText = firstLine.replace(/^#{1,6}\s+/, '').trim();
  if (firstText.toLowerCase() === stem.trim().toLowerCase()) return markdown;
  const heading = '# ' + stem.replace(/([\\`*_[\]<~])/g, '\\$1');
  return markdown.trim() ? `${heading}\n\n${markdown}` : heading + '\n';
}
