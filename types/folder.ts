// =============================================================================
// FOLDERS
// =============================================================================

/**
 * A folder as the app uses it: `name` is PLAINTEXT here, decrypted on the way
 * out of SQLite by mapRowToFolder(). The stored column is an `enc:v1:`
 * envelope. Same asymmetry Note already has for title/body -- see types/note.ts.
 */
export interface Folder {
  id: string;
  userId: string | null;
  parentId: string | null;
  name: string;
  kind: FolderKind;
  /** 0 = top level, up to MAX_FOLDER_DEPTH. */
  depth: number;
  sortOrder: number;
  /** Whether this folder's notes appear in All Notes. Never affects search. */
  includeInNotes: boolean;
  groupByDate: boolean;
  /** Switched on? A disabled folder is hidden from the sidebar and its notes
   *  are excluded from everything the plaintext broker will hand out. */
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;

  /**
   * True when the stored name could not be decrypted with the current data
   * key. Same purpose as Note.decryptFailed: an unreadable folder must not
   * present as an untitled one, because rename would then happily overwrite it.
   */
  decryptFailed?: boolean;
}

/**
 * What kind of folder this is, in a form the server can read.
 *
 * There is exactly one special kind, and the list is deliberately short: All
 * Notes and Recently Deleted are NOT here, because they are not rows. They are
 * views over state that already exists (every note; every trashed note), and
 * making either a real folder would give trash two sources of truth.
 */
export type FolderKind = 'user' | 'skills';

/** Five levels total: top level (0) plus four nested. */
export const MAX_FOLDER_DEPTH = 4;

export const SKILLS_FOLDER_NAME = 'Skills';

/**
 * What the sidebar is currently showing. Two of the three are virtual, which
 * is why this is a tagged union rather than `string | null`:
 *
 *   all       every note, minus folders with Include in Notes off
 *   trash     every trashed note -- the Recently Deleted surface
 *   folder    one real folder row, plus all of its descendants
 *
 * Modelling "All Notes" as `folderId: null` was the obvious alternative and is
 * wrong: null is already a meaningful folder_id (an unfiled note), so the two
 * would be indistinguishable.
 */
export type FolderSelection =
  | { kind: 'all' }
  | { kind: 'trash' }
  | { kind: 'folder'; id: string };

export const ALL_NOTES_SELECTION: FolderSelection = { kind: 'all' };
export const TRASH_SELECTION: FolderSelection = { kind: 'trash' };

export function isSameSelection(a: FolderSelection, b: FolderSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  return true;
}

/**
 * A folder plus the two things only the whole tree can tell you: how many
 * notes it holds, and whether it currently shows its children.
 *
 * `noteCount` is the folder's OWN notes, excluding trashed -- not an aggregate
 * over descendants. That is Apple Notes' behaviour and the recorded decision.
 * It is knowingly inconsistent with what selecting the folder shows (which
 * DOES include descendants); the count answers "what is filed here", the list
 * answers "what is under here".
 */
export interface FolderNode {
  folder: Folder;
  noteCount: number;
  children: FolderNode[];
}

/**
 * Build the render tree from a flat row set.
 *
 * Ordering is by sort_order then created_at -- never by name, which is
 * ciphertext in SQLite and so cannot be ordered server-side or in the query.
 * Sorting here, after decryption, is the only place it could happen; we
 * deliberately don't, because the user's explicit ordering outranks alphabetical.
 *
 * Rows whose parent is missing (mid-sync, or a subtree partially arrived) are
 * treated as top level rather than dropped: showing a folder in the wrong place
 * for a moment is better than making the user's folder vanish.
 */
export function buildFolderTree(
  folders: Folder[],
  counts: Map<string, number>
): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const folder of folders) {
    byId.set(folder.id, { folder, noteCount: counts.get(folder.id) ?? 0, children: [] });
  }

  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.folder.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const order = (a: FolderNode, b: FolderNode) =>
    a.folder.sortOrder - b.folder.sortOrder ||
    a.folder.createdAt.localeCompare(b.folder.createdAt);

  const sortDeep = (nodes: FolderNode[]) => {
    nodes.sort(order);
    for (const node of nodes) sortDeep(node.children);
  };
  sortDeep(roots);

  return roots;
}

/** Every folder id at or below `id`, including it. Used by delete. */
export function collectSubtreeIds(nodes: FolderNode[], id: string): string[] {
  const found = findNode(nodes, id);
  if (!found) return [];

  const ids: string[] = [];
  const walk = (node: FolderNode) => {
    ids.push(node.folder.id);
    node.children.forEach(walk);
  };
  walk(found);
  return ids;
}

export function findNode(nodes: FolderNode[], id: string): FolderNode | null {
  for (const node of nodes) {
    if (node.folder.id === id) return node;
    const inChild = findNode(node.children, id);
    if (inChild) return inChild;
  }
  return null;
}
