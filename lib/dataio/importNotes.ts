import { strFromU8, unzipSync } from 'fflate';

import { insertNoteInDB, listAllNotes, updateNoteInDB } from '@/lib/powersync/db';
import { createFolderInDB, listFolders } from '@/lib/powersync/folders';
import { MAX_FOLDER_DEPTH, type Folder } from '@/types/folder';
import { parseNoteContent } from '@/types/note';
import { buildImportTree, withTitleHeading, type ImportDir, type ImportFile } from './archiveLayout';
import { contentKey, resolveCollision, type ExistingNote } from './collisions';
import { runJob, type JobReport } from './dataJobs';
import { plural } from './exportNotes';
import { pickZip } from './fileIO';
import { markdownToHtml } from './markdownToHtml';

/**
 * Import: pick a zip, read it, and file its notes into this account.
 *
 * Decrypted local data only, as with export -- the zip is read from the OS
 * picker into memory, and every note is written through the same local insert
 * the editor uses, which encrypts before anything is stored. Upload to the
 * server then happens the normal way, as ciphertext.
 */

export interface ImportOptions {
  /** Where the zip's top level lands. Default 'allNotes' (Stage 15 prompt). */
  placement: 'allNotes' | 'imported';
  /** Replace a same-titled note whose content differs, instead of keeping both. */
  overwrite: boolean;
}

/** The folder every "Imported" placement reuses. See `importedFolder`. */
export const IMPORTED_FOLDER_NAME = 'Imported';

/**
 * Limits on what a zip may inflate to.
 *
 * A zip is untrusted input, and a small one can decompress to gigabytes (a
 * "zip bomb") -- enough to kill the app, which on a phone means losing
 * whatever else was in memory. Sizes are checked from the zip's own directory
 * BEFORE anything is decompressed (fflate's `filter` reports them without
 * inflating), so an oversized entry is refused, not half-read.
 *
 * Generous for notes: the largest real note here is a few kilobytes.
 */
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** Pick a zip and import it. Returns without starting a job if the user cancels. */
export async function startImport(options: ImportOptions): Promise<void> {
  const picked = await pickZip();
  if (!picked) return;
  await runJob('import', ({ progress, yieldToUi }) => importZip(picked.bytes, options, progress, yieldToUi));
}

interface Counts {
  created: number;
  duplicated: number;
  skipped: number;
  overwritten: number;
  failed: number;
  trashed: number;
  foldersCreated: number;
}

async function importZip(
  zip: Uint8Array,
  options: ImportOptions,
  progress: (phase: string, done: number, total: number) => void,
  yieldToUi: () => Promise<void>
): Promise<JobReport> {
  const report: JobReport = { lines: [], problems: [] };

  // ── Read the zip, one entry at a time ───────────────────────────────────
  progress('Reading the zip', 0, 0);
  const listing: { name: string; originalSize: number }[] = [];
  try {
    unzipSync(zip, {
      filter: (f) => {
        listing.push({ name: f.name, originalSize: f.originalSize });
        return false; // list only -- nothing is inflated here
      },
    });
  } catch {
    throw new Error('this file is not a readable zip');
  }

  const entries: { path: string; text: string | null }[] = [];
  let totalBytes = 0;
  for (const item of listing) {
    if (item.name.endsWith('/')) {
      entries.push({ path: item.name, text: null });
      continue;
    }
    if (item.originalSize > MAX_ENTRY_BYTES) {
      report.problems.push(`“${item.name}” was skipped: larger than ${MAX_ENTRY_BYTES / 1024 / 1024} MB.`);
      continue;
    }
    totalBytes += item.originalSize;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`the zip expands to more than ${MAX_TOTAL_BYTES / 1024 / 1024} MB`);
    }
    // Only notes are worth inflating. Everything else is reported by
    // buildImportTree from its name alone.
    if (!/\.(md|markdown|txt)$/i.test(item.name) && !item.name.endsWith('.notes-export.json')) {
      entries.push({ path: item.name, text: '' });
      continue;
    }
    try {
      // One entry per call, so a corrupt entry fails alone rather than taking
      // the whole archive with it.
      const out = unzipSync(zip, { filter: (f) => f.name === item.name });
      entries.push({ path: item.name, text: strFromU8(out[item.name]) });
    } catch {
      report.problems.push(`“${item.name}” could not be read from the zip.`);
    }
  }

  const tree = buildImportTree(entries);
  for (const i of tree.ignored) report.problems.push(`“${i.path}” was ignored: ${i.reason}.`);

  // ── What already exists ─────────────────────────────────────────────────
  progress('Checking existing notes', 0, 0);
  const [folders, notes] = await Promise.all([listFolders(), listAllNotes()]);

  // Folders are REUSED by name under the same parent, so importing your own
  // export back files notes into the folders they came from -- and the
  // collision rules, which compare within a folder, can then actually fire.
  // Without reuse every import would build a parallel "Work (2)" tree and
  // nothing would ever be recognised as already there.
  const folderIndex = new Map<string, Folder>();
  const folderKey = (parentId: string | null, name: string) => `${parentId ?? ''}/${name.toLowerCase()}`;
  // Every kind, Skills included: re-importing an export must file skills back
  // into the real Skills folder, not build a second folder that is merely
  // NAMED Skills beside it.
  for (const f of folders) {
    if (!f.decryptFailed) folderIndex.set(folderKey(f.parentId, f.name), f);
  }

  // Existing live notes by folder + exact title; keys are computed lazily,
  // because most notes are never compared against anything.
  type Slot = { id: string; body: string; key?: string; updatedAt: string };
  const liveIndex = new Map<string, Slot[]>();
  const trashIndex = new Map<string, Slot[]>();
  const slotKey = (folderId: string | null, title: string) => `${folderId ?? ''}\u0000${title}`;
  for (const n of notes) {
    if (n.decryptFailed) continue;
    const slot: Slot = { id: n.id, body: n.body, updatedAt: n.updatedAt };
    const index = n.isTrashed ? trashIndex : liveIndex;
    const key = n.isTrashed ? slotKey(null, n.title) : slotKey(n.folderId, n.title);
    index.set(key, [...(index.get(key) ?? []), slot]);
  }
  const asExisting = (slots: Slot[]): ExistingNote[] =>
    slots.map((s) => {
      s.key ??= contentKey(s.body);
      return { id: s.id, key: s.key, updatedAt: s.updatedAt };
    });

  const counts: Counts = { created: 0, duplicated: 0, skipped: 0, overwritten: 0, failed: 0, trashed: 0, foldersCreated: 0 };
  const degraded = new Set<string>();
  let depthCapped = 0;

  // ── Destination ─────────────────────────────────────────────────────────
  const ensureFolder = async (parent: Folder | null, name: string): Promise<Folder> => {
    const existing = folderIndex.get(folderKey(parent?.id ?? null, name));
    if (existing) return existing;
    // Include-in-Notes ON, so imported notes appear in All Notes without the
    // user going to find the switch (Stage 15 prompt, and createFolderInDB's
    // own default -- stated here because machine-made folders are exactly
    // where a default gets missed).
    const created = await createFolderInDB({ name, parentId: parent?.id ?? null, includeInNotes: true });
    folderIndex.set(folderKey(parent?.id ?? null, name), created);
    counts.foldersCreated++;
    return created;
  };

  // "Imported" is found by NAME at the top level, and created only if absent,
  // so every import reuses the same one -- never "Imported 2". Renaming it is
  // how a user says "start a new one".
  const base = options.placement === 'imported' ? await ensureFolder(null, IMPORTED_FOLDER_NAME) : null;

  // ── Notes ───────────────────────────────────────────────────────────────
  const totalFiles = countFiles(tree.root) + tree.trash.length;
  let done = 0;
  const step = async () => {
    done++;
    progress('Importing', done, totalFiles);
    await yieldToUi();
  };

  const toHtml = (file: ImportFile): string => {
    const markdown = tree.fromThisApp ? file.text : withTitleHeading(file.text, file.stem);
    const { html, degraded: lost } = markdownToHtml(markdown);
    lost.forEach((d) => degraded.add(d));
    return html;
  };

  const importFile = async (file: ImportFile, folder: Folder | null) => {
    try {
      const html = toHtml(file);
      if (!html) {
        counts.skipped++;
        report.problems.push(`“${file.path}” was skipped: it is empty.`);
        return;
      }
      const { title } = parseNoteContent(html);
      const key = slotKey(folder?.id ?? null, title);
      const slots = liveIndex.get(key) ?? [];
      const decision = resolveCollision(asExisting(slots), contentKey(html), options.overwrite);

      switch (decision.action) {
        case 'skip':
          counts.skipped++;
          return;
        case 'overwrite': {
          await updateNoteInDB(decision.existingId, html);
          const slot = slots.find((s) => s.id === decision.existingId)!;
          slot.body = html;
          slot.key = undefined;
          counts.overwritten++;
          return;
        }
        case 'create':
        case 'duplicate': {
          const note = await insertNoteInDB({ folderId: folder?.id ?? null, body: html });
          // Recorded, so a zip holding the same note twice skips the second.
          liveIndex.set(key, [...slots, { id: note.id, body: html, updatedAt: note.updatedAt }]);
          if (decision.action === 'create') counts.created++;
          else counts.duplicated++;
          return;
        }
      }
    } catch (err) {
      counts.failed++;
      report.problems.push(`“${file.path}” could not be imported: ${err instanceof Error ? err.message : String(err)}.`);
    }
  };

  const walk = async (dir: ImportDir, folder: Folder | null, depth: number) => {
    for (const file of dir.files) {
      await importFile(file, folder);
      await step();
    }
    for (const sub of dir.dirs) {
      // The folder a subdirectory WOULD create is at `depth + 1`. Past the
      // five-level cap it is not created; its notes go into the deepest folder
      // that exists instead, and the report says so.
      if (depth + 1 > MAX_FOLDER_DEPTH) {
        depthCapped += countFiles(sub);
        await walk(flatten(sub), folder, depth);
        continue;
      }
      let child: Folder;
      try {
        child = await ensureFolder(folder, sub.name);
      } catch (err) {
        counts.failed += countFiles(sub);
        report.problems.push(`Folder “${sub.name}” could not be created, so its notes were not imported.`);
        for (let i = 0; i < countFiles(sub); i++) await step();
        continue;
      }
      await walk(sub, child, depth + 1);
    }
  };

  // Top-level folders start at depth 0; under "Imported" they start one lower.
  await walk(tree.root, base, base ? base.depth : -1);

  // Recently Deleted goes back into the trash -- see the Decisions Log.
  for (const file of tree.trash) {
    try {
      const html = toHtml(file);
      if (html) {
        const { title } = parseNoteContent(html);
        const key = slotKey(null, title);
        const slots = trashIndex.get(key) ?? [];
        const decision = resolveCollision(asExisting(slots), contentKey(html), false);
        if (decision.action === 'skip') counts.skipped++;
        else {
          const note = await insertNoteInDB({ folderId: null, body: html, trashed: true });
          trashIndex.set(key, [...slots, { id: note.id, body: html, updatedAt: note.updatedAt }]);
          counts.trashed++;
        }
      }
    } catch (err) {
      counts.failed++;
      report.problems.push(`“${file.path}” could not be imported: ${err instanceof Error ? err.message : String(err)}.`);
    }
    await step();
  }

  // ── Report ──────────────────────────────────────────────────────────────
  // All five counts, always -- including zeros. "A silent import on someone's
  // whole notes archive is unnerving" (Stage 15 prompt), and a count that
  // disappears when it is zero is a count the user cannot rely on.
  report.lines.push(
    `Created ${counts.created}, duplicated ${counts.duplicated}, skipped ${counts.skipped}, ` +
      `overwritten ${counts.overwritten}, failed ${counts.failed}.`
  );
  if (counts.trashed) report.lines.push(`${plural(counts.trashed, 'note')} went into Recently Deleted.`);
  if (counts.foldersCreated) report.lines.push(`${plural(counts.foldersCreated, 'folder')} created.`);
  if (depthCapped) {
    report.lines.push(
      `${plural(depthCapped, 'note')} came from folders deeper than ${MAX_FOLDER_DEPTH + 1} levels and ${depthCapped === 1 ? 'was' : 'were'} placed in the deepest folder allowed.`
    );
  }
  if (degraded.size) report.lines.push(`Simplified to fit the editor: ${[...degraded].join(', ')}.`);
  if (counts.skipped && !options.overwrite) {
    report.lines.push('Skipped notes were already here with the same title and content.');
  }
  return report;
}

function countFiles(dir: ImportDir): number {
  return dir.files.length + dir.dirs.reduce((n, d) => n + countFiles(d), 0);
}

/** Every file under a directory, as one level -- for folders past the depth cap. */
function flatten(dir: ImportDir): ImportDir {
  const files: ImportFile[] = [];
  const collect = (d: ImportDir) => {
    files.push(...d.files);
    d.dirs.forEach(collect);
  };
  collect(dir);
  return { name: dir.name, files, dirs: [] };
}
