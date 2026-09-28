import { strToU8, zipSync } from 'fflate';

import { listAllNotes } from '@/lib/powersync/db';
import { listFolders } from '@/lib/powersync/folders';
import { escapeInline, htmlToMarkdown, type MarkdownResult } from './htmlToMarkdown';
import { planExport, type ExportScope, type LayoutFolder, type LayoutNote } from './archiveLayout';
import { runJob, type JobReport } from './dataJobs';
import { saveZip } from './fileIO';

/**
 * Export: read every note in scope, convert, zip, hand to the user.
 *
 * Everything happens on DECRYPTED LOCAL DATA. The notes come out of this
 * device's own database (decrypted by the same code the editor uses), the zip
 * is built in memory, and the file goes to the OS share sheet or a browser
 * download. There is no network call anywhere on this path -- the server only
 * ever holds ciphertext, and nothing here asks it for anything.
 */
export function startExport(scope: ExportScope): Promise<void> {
  return runJob('export', async ({ progress, yieldToUi }) => {
    progress('Reading notes', 0, 0);
    const [folders, notes] = await Promise.all([listFolders(), listAllNotes()]);

    const layoutFolders: LayoutFolder[] = folders.map((f) => ({
      id: f.id,
      // An undecryptable folder name is unknown, not empty.
      name: f.decryptFailed ? 'Unreadable folder' : f.name,
      parentId: f.parentId,
      includeInNotes: f.includeInNotes,
    }));
    const layoutNotes: LayoutNote[] = notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      folderId: n.folderId,
      isTrashed: n.isTrashed,
      decryptFailed: n.decryptFailed,
    }));

    // Convert one note at a time, yielding between each -- see yieldToUi.
    const converted = new Map<string, MarkdownResult>();
    for (let i = 0; i < layoutNotes.length; i++) {
      const note = layoutNotes[i];
      if (!note.decryptFailed) {
        try {
          converted.set(note.id, htmlToMarkdown(note.body));
        } catch (err) {
          // htmlToMarkdown is written not to throw; this is the backstop that
          // keeps one note from sinking the export if it ever does. Degrade to
          // the note's plain text rather than drop it -- a regex strip cannot
          // throw -- and let the report say its formatting was lost.
          console.warn('Export: could not convert a note', err);
          const text = note.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          converted.set(note.id, { markdown: escapeInline(text) + '\n', unmappedTags: ['unconvertible'] });
        }
      }
      progress('Converting', i + 1, layoutNotes.length);
      await yieldToUi();
    }

    const exportedAt = new Date().toISOString();
    const plan = planExport(layoutFolders, layoutNotes, scope, exportedAt, converted);
    const total = plan.noteCount + plan.trashedCount;

    const report: JobReport = { lines: [], problems: [] };
    for (const s of plan.skipped) report.problems.push(`“${s.title}” was left out: ${s.reason}.`);

    if (total === 0) {
      report.lines.push('There were no notes to export in this selection, so no file was made.');
      return report;
    }

    progress('Compressing', 0, 1);
    await yieldToUi();
    const files: Record<string, Uint8Array> = {};
    for (const entry of plan.entries) files[entry.path] = strToU8(entry.content);
    const zipped = zipSync(files, { level: 6 });

    progress('Saving', 1, 1);
    const fileName = `Notes export ${exportedAt.slice(0, 10)}.zip`;
    const outcome = await saveZip(zipped, fileName);
    if (outcome === 'unavailable') {
      throw new Error('this device has no way to share or save a file');
    }

    report.lines.push(
      `Exported ${plural(plan.noteCount, 'note')}` +
        (plan.trashedCount ? `, plus ${plural(plan.trashedCount, 'note')} from Recently Deleted` : '') +
        '.'
    );
    if (plan.simplified.length) {
      report.lines.push(
        `${plural(plan.simplified.length, 'note')} had formatting Markdown cannot express; the text is kept, the formatting is not.`
      );
    }
    if (plan.skipped.length) report.lines.push(`${plural(plan.skipped.length, 'note')} could not be exported — see below.`);
    report.lines.push(
      outcome === 'downloaded' ? `Saved as “${fileName}”.` : `“${fileName}” was handed to the share sheet.`
    );
    return report;
  });
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
