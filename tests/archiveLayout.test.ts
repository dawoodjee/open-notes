import { describe, it, expect } from './harness';
import {
  EXPORT_MARKER,
  buildImportTree,
  planExport,
  safeName,
  uniqueName,
  withTitleHeading,
  type LayoutFolder,
  type LayoutNote,
} from '../lib/dataio/archiveLayout';
import { contentKey, resolveCollision } from '../lib/dataio/collisions';

const AT = '2026-09-28T00:00:00.000Z';
const body = (text: string) => `<html><h1>${text}</h1></html>`;

// Work › Projects › Q3, with notes only in Q3 -- the shape that motivated the
// top-wrappers-only rule.
const folders: LayoutFolder[] = [
  { id: 'w', name: 'Work', parentId: null, includeInNotes: true },
  { id: 'p', name: 'Projects', parentId: 'w', includeInNotes: true },
  { id: 'q', name: 'Q3', parentId: 'p', includeInNotes: true },
  { id: 'h', name: 'Hidden', parentId: null, includeInNotes: false },
];
const notes: LayoutNote[] = [
  { id: '1', title: 'Plan', body: body('Plan'), folderId: 'q', isTrashed: false },
  { id: '2', title: 'Loose', body: body('Loose'), folderId: null, isTrashed: false },
  { id: '3', title: 'Secret', body: body('Secret'), folderId: 'h', isTrashed: false },
  { id: '4', title: 'Gone', body: body('Gone'), folderId: 'w', isTrashed: true },
];
const paths = (entries: { path: string }[]) => entries.map((e) => e.path).filter((p) => !p.endsWith('/') && p !== EXPORT_MARKER);

describe('safeName — titles are arbitrary user text', () => {
  it('path separators and Windows-illegal characters', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j', 'x')).toBe('a-b-c-d-e-f-g-h-i-j');
  });
  it('empty and whitespace-only titles', () => {
    expect(safeName('', 'Untitled')).toBe('Untitled');
    expect(safeName('   ', 'Untitled')).toBe('Untitled');
  });
  it('trailing dots — Windows strips them, so "Notes." and "Notes" would collide', () => {
    expect(safeName('Notes...', 'x')).toBe('Notes');
  });
  it('Windows reserved device names', () => {
    expect(safeName('CON', 'x')).toBe('CON_');
    expect(safeName('com1', 'x')).toBe('com1_');
  });
  it('length is capped on code points, never splitting an emoji', () => {
    const long = '😀'.repeat(150);
    const out = safeName(long, 'x');
    expect(Array.from(out).length).toBe(100);
    expect(out).toBe('😀'.repeat(100));
  });
});

describe('uniqueName — case-insensitive, because macOS and Windows are', () => {
  it('numbers duplicates', () => {
    const taken = new Set<string>();
    expect(uniqueName('Notes', taken, '.md')).toBe('Notes.md');
    expect(uniqueName('notes', taken, '.md')).toBe('notes (2).md');
    expect(uniqueName('Notes', taken, '.md')).toBe('Notes (3).md');
  });
});

describe('planExport — scope', () => {
  it('Everything: every note, trashed ones under Recently Deleted with their old path', () => {
    const plan = planExport(folders, notes, { kind: 'everything' }, AT);
    expect(paths(plan.entries).sort()).toEqual([
      'Hidden/Secret.md',
      'Loose.md',
      'Recently Deleted/Work/Gone.md',
      'Work/Projects/Q3/Plan.md',
    ]);
    expect(plan.noteCount).toBe(3);
    expect(plan.trashedCount).toBe(1);
  });

  it('All Notes: what the All Notes list shows — no trash, no excluded folders', () => {
    const plan = planExport(folders, notes, { kind: 'allNotes' }, AT);
    expect(paths(plan.entries).sort()).toEqual(['Loose.md', 'Work/Projects/Q3/Plan.md']);
  });

  it('A folder: its subtree, with the folder itself as the top directory', () => {
    const plan = planExport(folders, notes, { kind: 'folder', folderId: 'p' }, AT);
    expect(paths(plan.entries)).toEqual(['Projects/Q3/Plan.md']);
  });

  it('empty intermediate folders are written as directories, so they survive', () => {
    const dirs = planExport(folders, notes, { kind: 'everything' }, AT).entries
      .map((e) => e.path)
      .filter((p) => p.endsWith('/'));
    expect(dirs.includes('Work/') && dirs.includes('Work/Projects/')).toBe(true);
  });

  it('every zip we write carries the marker at its root', () => {
    expect(planExport(folders, notes, { kind: 'allNotes' }, AT).entries[0].path).toBe(EXPORT_MARKER);
  });

  it('an undecryptable note is skipped and reported, never written empty', () => {
    const broken: LayoutNote = { id: '9', title: '', body: '', folderId: null, isTrashed: false, decryptFailed: true };
    const plan = planExport([], [broken], { kind: 'everything' }, AT);
    expect(paths(plan.entries)).toEqual([]);
    expect(plan.skipped.length).toBe(1);
  });

  it('two notes with the same title in one folder both survive', () => {
    const twins: LayoutNote[] = [
      { id: 'a', title: 'Same', body: body('Same'), folderId: null, isTrashed: false },
      { id: 'b', title: 'same', body: body('same'), folderId: null, isTrashed: false },
    ];
    expect(paths(planExport([], twins, { kind: 'everything' }, AT).entries)).toEqual(['Same.md', 'same (2).md']);
  });

  it('a user folder named "Recently Deleted" cannot merge into the trash directory', () => {
    const clash: LayoutFolder[] = [{ id: 'r', name: 'Recently Deleted', parentId: null, includeInNotes: true }];
    const n: LayoutNote[] = [
      { id: 'a', title: 'Mine', body: body('Mine'), folderId: 'r', isTrashed: false },
      { id: 'b', title: 'Trashed', body: body('Trashed'), folderId: null, isTrashed: true },
    ];
    expect(paths(planExport(clash, n, { kind: 'everything' }, AT).entries).sort()).toEqual([
      'Recently Deleted (2)/Mine.md',
      'Recently Deleted/Trashed.md',
    ]);
  });
});

describe('buildImportTree — top wrappers only (Adam, 2026-09-28)', () => {
  const file = (path: string) => ({ path, text: '# x' });

  it('a foreign zip\'s single wrapper directory is unwrapped', () => {
    const tree = buildImportTree([file('MyExport/Work/a.md')]);
    // MyExport is a wrapper; Work is the root's only dir too, and has no notes,
    // so it unwraps as well — that is the accepted cost for FOREIGN zips.
    expect(tree.root.files.map((f) => f.stem)).toEqual(['a']);
    expect(tree.fromThisApp).toBe(false);
  });

  it('interior note-less folders are kept — the literal rule would have erased them', () => {
    const tree = buildImportTree([file('Work/Projects/Q3/a.md'), file('Loose.md')]);
    expect(tree.root.dirs[0].name).toBe('Work');
    expect(tree.root.dirs[0].dirs[0].name).toBe('Projects');
    expect(tree.root.dirs[0].dirs[0].dirs[0].name).toBe('Q3');
  });

  it('our marker stops unwrapping — a single-folder export keeps its folder', () => {
    const tree = buildImportTree([{ path: EXPORT_MARKER, text: '{}' }, file('Work/a.md')]);
    expect(tree.root.dirs.map((d) => d.name)).toEqual(['Work']);
    expect(tree.fromThisApp).toBe(true);
  });

  it('a re-zipped export: the wrapper goes, the marker\'s level stays', () => {
    const tree = buildImportTree([{ path: `Wrapper/${EXPORT_MARKER}`, text: '{}' }, file('Wrapper/Work/a.md')]);
    expect(tree.root.dirs.map((d) => d.name)).toEqual(['Work']);
  });

  it('Recently Deleted at the top is routed to the trash', () => {
    const tree = buildImportTree([{ path: EXPORT_MARKER, text: '{}' }, file('Recently Deleted/Work/gone.md'), file('kept.md')]);
    expect(tree.trash.map((f) => f.stem)).toEqual(['gone']);
    expect(tree.root.dirs.map((d) => d.name)).toEqual([]);
  });

  it('macOS resource forks, hidden files and non-notes are left out — non-notes reported', () => {
    const tree = buildImportTree([
      file('a.md'),
      file('__MACOSX/._a.md'),
      file('.DS_Store'),
      { path: 'photo.png', text: '' },
    ]);
    expect(tree.root.files.map((f) => f.stem)).toEqual(['a']);
    expect(tree.ignored).toEqual([{ path: 'photo.png', reason: 'not a Markdown or text file' }]);
  });

  it('a UTF-8 byte-order mark is stripped', () => {
    expect(buildImportTree([{ path: 'a.md', text: '﻿# a' }]).root.files[0].text).toBe('# a');
  });
});

describe('withTitleHeading — foreign files titled only by filename', () => {
  it('adds the filename as a heading', () => {
    expect(withTitleHeading('Some body', 'Shopping')).toBe('# Shopping\n\nSome body');
  });
  it('leaves a body that already starts with its title alone', () => {
    expect(withTitleHeading('# Shopping\n\nbody', 'Shopping')).toBe('# Shopping\n\nbody');
  });
});

describe('collisions — "identical" is compared as Markdown', () => {
  it('bold-in-italic and italic-in-bold are identical content', () => {
    expect(contentKey('<html><p><b><i>x</i></b></p></html>')).toBe(contentKey('<html><p><i><b>x</b></i></p></html>'));
  });
  it('native block newlines are not content', () => {
    expect(contentKey('<html>\n<h1>T</h1>\n<p>b</p>\n</html>')).toBe(contentKey('<html><h1>T</h1><p>b</p></html>'));
  });
  it('a real edit is a difference', () => {
    expect(contentKey('<html><p>b</p></html>') === contentKey('<html><p>B</p></html>')).toBe(false);
  });

  const existing = [{ id: 'old', key: 'k1', updatedAt: '2026-01-01' }, { id: 'new', key: 'k2', updatedAt: '2026-02-01' }];
  it('no same-title note → create', () => {
    expect(resolveCollision([], 'k', false)).toEqual({ action: 'create' });
  });
  it('identical → skip, even with overwrite on', () => {
    expect(resolveCollision(existing, 'k1', true)).toEqual({ action: 'skip', existingId: 'old' });
  });
  it('different → duplicate', () => {
    expect(resolveCollision(existing, 'k3', false)).toEqual({ action: 'duplicate' });
  });
  it('different + overwrite → the most recently edited is overwritten', () => {
    expect(resolveCollision(existing, 'k3', true)).toEqual({ action: 'overwrite', existingId: 'new' });
  });
});
