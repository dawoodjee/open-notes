/**
 * Stage 10 — the client-side half of the folder verification.
 *
 * scripts/verify-folders-postgres.sh covers everything the server decides
 * (depth, RLS, delete semantics, constraints). This covers what the client
 * decides: the purge cutoff, subtree collection, the Include-in-Notes filter
 * versus search, and tree construction.
 *
 * SCOPE NOTE, same as verify-crypto.ts / verify-legacy-plaintext-backfill.ts:
 * lib/powersync/folders.ts cannot be imported here -- it reaches db.ts, which
 * pulls in @op-engineering/op-sqlite and expo-secure-store, neither of which
 * run under plain Node. So the SQL and control flow of the functions under
 * test are transcribed below, verbatim.
 *
 * What is NOT transcribed, and is imported for real: buildFolderTree and
 * collectSubtreeIds from types/folder.ts (pure functions, no native deps) and
 * the encrypt/decrypt in lib/crypto/envelope.ts. Those are the actual shipping
 * code.
 *
 * Usage: npx tsx scripts/verify-folders-local.ts
 */
import { existsSync, unlinkSync } from 'node:fs';
import { PowerSyncDatabase } from '@powersync/node';
import { AbstractPowerSyncDatabase } from '@powersync/common';
import { randomUUID } from 'node:crypto';
import { AppSchema } from '../lib/powersync/schema';
import { encrypt, decrypt } from '../lib/crypto/envelope';
import { generateDataKey } from '../lib/crypto/keys';
import {
  buildFolderTree,
  collectSubtreeIds,
  Folder,
  MAX_FOLDER_DEPTH,
} from '../types/folder';

const DB_FILE = './scripts/.verify-folders.db';
const TRASH_RETENTION_DAYS = 30;

let failed = 0;
function check(name: string, condition: boolean, detail = '') {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// --- transcribed from lib/powersync/folders.ts -----------------------------

async function subtreeFolderIds(
  db: AbstractPowerSyncDatabase,
  folderId: string
): Promise<string[]> {
  const ids = [folderId];
  let frontier = [folderId];
  for (let level = 0; level < MAX_FOLDER_DEPTH && frontier.length > 0; level++) {
    const placeholders = frontier.map(() => '?').join(',');
    const rows = await db.getAll<{ id: string }>(
      `SELECT id FROM folders WHERE parent_id IN (${placeholders})`,
      frontier
    );
    frontier = rows.map((r) => r.id);
    ids.push(...frontier);
  }
  return ids;
}

// --- transcribed from lib/powersync/db.ts's purgeExpiredTrash --------------

async function purgeExpiredTrash(db: AbstractPowerSyncDatabase): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000).toISOString();
  await db.execute(
    `DELETE FROM notes
     WHERE is_trashed = 1 AND trashed_at IS NOT NULL AND trashed_at < ?`,
    [cutoff]
  );
}

async function insertFolder(
  db: AbstractPowerSyncDatabase,
  key: Uint8Array,
  opts: { name: string; parentId?: string | null; depth?: number; includeInNotes?: boolean; kind?: string; sortOrder?: number }
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO folders (id, user_id, parent_id, name, kind, depth, sort_order, include_in_notes, group_by_date, created_at, updated_at)
     VALUES (?, 'u1', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      opts.parentId ?? null,
      encrypt(opts.name, key),
      opts.kind ?? 'user',
      opts.depth ?? 0,
      opts.sortOrder ?? 0,
      opts.includeInNotes === false ? 0 : 1,
      now,
      now,
    ]
  );
  return id;
}

async function insertNote(
  db: AbstractPowerSyncDatabase,
  key: Uint8Array,
  opts: { body: string; folderId?: string | null; trashedDaysAgo?: number }
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const trashed = opts.trashedDaysAgo !== undefined;
  await db.execute(
    `INSERT INTO notes (id, user_id, body, title, created_at, updated_at, is_trashed, trashed_at, is_hidden_from_api, folder_id)
     VALUES (?, 'u1', ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      encrypt(opts.body, key),
      encrypt(opts.body, key),
      now,
      now,
      trashed ? 1 : 0,
      trashed ? daysAgo(opts.trashedDaysAgo!) : null,
      opts.folderId ?? null,
    ]
  );
  return id;
}

async function main() {
  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: DB_FILE } });
  await db.init();
  const key = generateDataKey();

  try {
    // ---------------------------------------------------------------------
    console.log('\n=== 1. Subtree collection reaches every level ===');
    const root = await insertFolder(db, key, { name: 'Root', depth: 0 });
    let parent = root;
    const chain = [root];
    for (let d = 1; d <= MAX_FOLDER_DEPTH; d++) {
      parent = await insertFolder(db, key, { name: `L${d}`, parentId: parent, depth: d });
      chain.push(parent);
    }
    // A sibling branch, to prove the walk goes wide as well as deep.
    const sibling = await insertFolder(db, key, { name: 'Sibling', parentId: root, depth: 1 });

    const ids = await subtreeFolderIds(db, root);
    // root + 4 descendants (the full 5 levels) + 1 sibling of the root's child.
    check(
      'subtree of a 5-level chain plus a sibling returns all 6 folders',
      ids.length === 6,
      `got ${ids.length}: expected root + 4 in the chain + 1 sibling`
    );
    check('the deepest folder is included', ids.includes(chain[MAX_FOLDER_DEPTH]));
    check('the sibling branch is included', ids.includes(sibling));

    const partial = await subtreeFolderIds(db, chain[2]);
    check(
      'a subtree taken mid-chain returns only what is beneath it',
      partial.length === 3,
      `got ${partial.length}, expected level 2 plus levels 3 and 4`
    );

    // ---------------------------------------------------------------------
    console.log('\n=== 2. The 30-day purge, proven with back-dated rows ===');
    const old31 = await insertNote(db, key, { body: 'trashed 31 days ago', trashedDaysAgo: 31 });
    const fresh29 = await insertNote(db, key, { body: 'trashed 29 days ago', trashedDaysAgo: 29 });
    const boundary = await insertNote(db, key, { body: 'trashed 30.5 days ago', trashedDaysAgo: 30.5 });
    const live = await insertNote(db, key, { body: 'not trashed at all' });

    const before = await db.get<{ c: number }>('SELECT count(*) as c FROM notes');
    await purgeExpiredTrash(db);
    const after = await db.getAll<{ id: string }>('SELECT id FROM notes');
    const surviving = new Set(after.map((r) => r.id));

    console.log(`      ${before.c} notes before the sweep, ${after.length} after`);
    check('a note trashed 31 days ago is destroyed', !surviving.has(old31));
    check('a note trashed 30.5 days ago is destroyed', !surviving.has(boundary));
    check('a note trashed 29 days ago SURVIVES', surviving.has(fresh29));
    check('a note that was never trashed survives', surviving.has(live));

    // ---------------------------------------------------------------------
    console.log('\n=== 3. Include in Notes hides from All Notes, never from search ===');
    const shown = await insertFolder(db, key, { name: 'Visible', depth: 0, includeInNotes: true });
    const hidden = await insertFolder(db, key, { name: 'Hidden', depth: 0, includeInNotes: false });
    await insertNote(db, key, { body: 'findme in a listed folder', folderId: shown });
    await insertNote(db, key, { body: 'findme in an excluded folder', folderId: hidden });

    // The All Notes query, exactly as NoteListPane issues it.
    const allNotes = await db.getAll<{ body: string }>(
      `SELECT body FROM notes
       WHERE is_trashed = 0
         AND (folder_id IS NULL OR folder_id IN (SELECT id FROM folders WHERE include_in_notes = 1))`
    );
    const allBodies = allNotes.map((r) => decrypt(r.body, key));
    check(
      'All Notes shows the listed folder’s note',
      allBodies.some((b) => b.includes('in a listed folder'))
    );
    check(
      'All Notes does NOT show the excluded folder’s note',
      !allBodies.some((b) => b.includes('in an excluded folder'))
    );

    // The search query: every non-trashed note, no folder filter at all.
    const searchable = await db.getAll<{ body: string }>(
      'SELECT body FROM notes WHERE is_trashed = 0'
    );
    const hits = searchable
      .map((r) => decrypt(r.body, key))
      .filter((b) => b.toLowerCase().includes('findme'));
    check(
      'search finds BOTH notes, including the excluded one',
      hits.length === 2,
      `search returned ${hits.length} of 2`
    );

    // ---------------------------------------------------------------------
    console.log('\n=== 4. Counts are own-notes-only, not an aggregate ===');
    const counts = await db.getAll<{ folder_id: string; count: number }>(
      `SELECT folder_id, count(*) as count FROM notes
       WHERE is_trashed = 0 AND folder_id IS NOT NULL GROUP BY folder_id`
    );
    const countMap = new Map(counts.map((c) => [c.folder_id, c.count]));
    await insertNote(db, key, { body: 'deep note', folderId: chain[3] });

    const recounted = await db.getAll<{ folder_id: string; count: number }>(
      `SELECT folder_id, count(*) as count FROM notes
       WHERE is_trashed = 0 AND folder_id IS NOT NULL GROUP BY folder_id`
    );
    const recountMap = new Map(recounted.map((c) => [c.folder_id, c.count]));
    check(
      'a note filed deep counts against its own folder',
      recountMap.get(chain[3]) === 1
    );
    check(
      'and does NOT count against its ancestors',
      (recountMap.get(root) ?? 0) === 0 && (recountMap.get(chain[2]) ?? 0) === 0,
      `root=${recountMap.get(root) ?? 0}, level2=${recountMap.get(chain[2]) ?? 0}`
    );
    check('the pre-insert count map was empty for that folder', !countMap.has(chain[3]));

    // ---------------------------------------------------------------------
    console.log('\n=== 5. Tree building (real buildFolderTree, not transcribed) ===');
    const rows = await db.getAll<any>(
      'SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC'
    );
    const folders: Folder[] = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      parentId: r.parent_id ?? null,
      name: decrypt(r.name, key),
      kind: r.kind === 'skills' ? 'skills' : 'user',
      depth: r.depth,
      sortOrder: r.sort_order,
      includeInNotes: Boolean(r.include_in_notes),
      groupByDate: Boolean(r.group_by_date),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const tree = buildFolderTree(folders, recountMap);
    const rootNode = tree.find((n) => n.folder.id === root);
    check('the tree has 3 top-level folders', tree.length === 3, `got ${tree.length}`);
    check('the root has 2 children (the chain and the sibling)', rootNode?.children.length === 2);

    const subtreeViaTree = collectSubtreeIds(tree, root);
    check(
      'collectSubtreeIds agrees with the SQL walk',
      subtreeViaTree.length === ids.length &&
        subtreeViaTree.every((i) => ids.includes(i)),
      `tree walk found ${subtreeViaTree.length}, SQL walk found ${ids.length}`
    );

    // An orphan -- a subfolder whose parent hasn't arrived yet mid-sync --
    // must still render rather than vanish.
    const orphan: Folder = {
      id: 'orphan', userId: 'u1', parentId: 'a-parent-that-has-not-synced-yet',
      name: 'Orphan', kind: 'user', depth: 1, sortOrder: 99,
      includeInNotes: true, groupByDate: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const withOrphan = buildFolderTree([...folders, orphan], recountMap);
    check(
      'a folder whose parent has not arrived is shown at top level, not dropped',
      withOrphan.some((n) => n.folder.id === 'orphan'),
      'mid-sync, a subtree can arrive parent-last; losing the folder would look like data loss'
    );
  } finally {
    await db.disconnectAndClear().catch(() => {});
    await db.close().catch(() => {});
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  }

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
