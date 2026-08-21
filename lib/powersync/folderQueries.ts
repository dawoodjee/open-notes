/**
 * SQL fragments shared between the app and its verification scripts.
 *
 * WHY THIS IS ITS OWN FILE WITH NO IMPORTS: everything else in lib/powersync
 * reaches db.ts, which pulls in @op-engineering/op-sqlite and expo-secure-store
 * -- neither of which runs under plain Node. The verify scripts therefore
 * TRANSCRIBE the SQL they check (see the scope note in each), which is fine for
 * ordinary queries and not fine for these two: they are the predicate that
 * decides whether a disabled folder's notes can leave the device. A transcribed
 * copy of that can drift from the real one silently, and the test would keep
 * passing while the app stopped enforcing it.
 *
 * Kept dependency-free so scripts/verify-folders-local.ts imports the exact
 * strings the broker uses.
 */

/**
 * Folders that are switched off, and everything beneath them.
 *
 * A recursive CTE rather than a JS walk so it drops straight into an existing
 * WHERE clause -- one atomic query, with no window in which a caller holds a
 * stale list of ids. Terminates regardless of data shape: UNION (not UNION ALL)
 * de-duplicates, so even a cycle -- which the server's depth trigger makes
 * impossible -- could not loop forever.
 */
export const DISABLED_FOLDER_SUBTREE_CTE = `
  WITH RECURSIVE disabled_folders(id) AS (
    SELECT id FROM folders WHERE is_enabled = 0
    UNION
    SELECT f.id FROM folders f JOIN disabled_folders d ON f.parent_id = d.id
  )`;

/**
 * The predicate that goes with the CTE above.
 *
 * A note with no folder is never excluded -- being unfiled cannot put it inside
 * a disabled folder, and treating NULL as "excluded" would hide every unfiled
 * note from apps the moment any folder was switched off.
 */
export const NOT_IN_DISABLED_FOLDER =
  '(folder_id IS NULL OR folder_id NOT IN (SELECT id FROM disabled_folders))';
