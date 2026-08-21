import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { FolderPlus } from 'lucide-react-native';

import { FolderRow } from './FolderRow';
import { FolderContextMenu, FolderMenuTarget } from './FolderContextMenu';
import { DeleteFolderDialog, FolderNameDialog } from './DeleteFolderDialog';
import {
  FolderNode,
  FolderSelection,
  MAX_FOLDER_DEPTH,
  findNode,
  isSameSelection,
} from '@/types/folder';

/**
 * The folder pane.
 *
 * COMPOSITION, which is the whole layout rule: All Notes is always first,
 * Recently Deleted is always last and is never reorderable, and everything the
 * user actually owns sits between them in sort_order. Neither bookend is a
 * folder row -- they are views over state that already exists (every note;
 * every trashed note), so there is nothing in the database to reorder them
 * against and nothing that could drift out of step with the notes table.
 *
 * Skills IS a row, and is therefore movable like any other. It simply starts
 * at sort_order 0, which puts it first among the real folders.
 */

export interface FolderSidebarProps {
  tree: FolderNode[];
  selection: FolderSelection;
  allNotesCount: number;
  trashCount: number;
  expandedIds: Set<string>;
  isVisible: boolean;
  /**
   * True when this pane sits BESIDE the list rather than replacing it.
   *
   * Drives the width, and the two cases are genuinely different rather than
   * one being a smaller version of the other: beside the list it is a fixed
   * column, and replacing it it is the whole screen. Without the second case
   * the pane renders at its content width and the editor keeps the rest, so
   * the sidebar appears as a half-width strip.
   */
  isPersistent: boolean;
  /** Web/desktop only: the pane's pixel width. */
  width?: number;
  onSelect: (selection: FolderSelection) => void;
  onToggleExpanded: (folderId: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onToggleIncludeInNotes: (folderId: string, next: boolean) => void;
  onToggleGroupByDate: (folderId: string, next: boolean) => void;
  onMoveFolder: (folderId: string, direction: -1 | 1) => void;
}

type PendingDialog =
  | { kind: 'create'; parentId: string | null; parentLabel: string }
  | { kind: 'rename'; folderId: string; current: string }
  | { kind: 'delete'; folderId: string; label: string; noteCount: number; subfolderCount: number }
  | null;

export function FolderSidebar({
  tree,
  selection,
  allNotesCount,
  trashCount,
  expandedIds,
  isVisible,
  isPersistent,
  width,
  onSelect,
  onToggleExpanded,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleIncludeInNotes,
  onToggleGroupByDate,
  onMoveFolder,
}: FolderSidebarProps) {
  const insets = useSafeAreaInsets();
  const [menuTarget, setMenuTarget] = useState<FolderMenuTarget | null>(null);
  const [dialog, setDialog] = useState<PendingDialog>(null);
  const [isEditing, setIsEditing] = useState(false);

  const topLevelIds = useMemo(() => tree.map((n) => n.folder.id), [tree]);

  const openMenuFor = useCallback(
    (target: FolderMenuTarget) => setMenuTarget(target),
    []
  );

  const handleDeleteRequest = useCallback(
    (target: FolderMenuTarget) => {
      if (!target.folderId) return;
      const node = findNode(tree, target.folderId);
      if (!node) return;

      const subfolderCount = countDescendants(node);
      const noteCount = sumNotes(node);

      // Silent when there is genuinely nothing to lose. A confirmation for an
      // empty folder is how people learn to dismiss confirmations unread.
      if (noteCount === 0 && subfolderCount === 0) {
        onDeleteFolder(target.folderId);
        return;
      }

      setDialog({
        kind: 'delete',
        folderId: target.folderId,
        label: target.label,
        noteCount,
        subfolderCount,
      });
    },
    [tree, onDeleteFolder]
  );

  if (!isVisible) return null;

  return (
    <View
      style={{ paddingTop: insets.top, ...(width ? { width } : {}) }}
      className={`bg-secondary h-full ${
        isPersistent ? 'border-r border-border shrink-0 md:w-72' : 'w-full flex-1'
      }`}
    >
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        {/* Truncates rather than clipping. At Android font_scale 1.6 this
            title and the Edit button were both hard-clipped mid-word
            ("Folder", "E") because nothing told either one how to yield. */}
        <RNText
          className="text-3xl font-bold text-foreground flex-1 min-w-0"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          Folders
        </RNText>

        <View className="flex-row items-center gap-1 shrink-0">
          <Pressable
            onPress={() => setDialog({ kind: 'create', parentId: null, parentLabel: 'Folders' })}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
            accessibilityRole="button"
            accessibilityLabel="New folder"
          >
            <Icon as={FolderPlus} className="w-6 h-6 text-lime-600 dark:text-lime-400" />
          </Pressable>

          <Pressable
            onPress={() => setIsEditing((v) => !v)}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
            accessibilityRole="button"
            accessibilityLabel={isEditing ? 'Done reordering folders' : 'Reorder folders'}
          >
            <RNText
              className="text-base text-lime-600 dark:text-lime-400 font-medium"
              numberOfLines={1}
            >
              {isEditing ? 'Done' : 'Edit'}
            </RNText>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingBottom: insets.bottom + 16,
        }}
      >
        {/* All Notes -- always first, never reorderable, never renameable. */}
        <FolderRow
          label="All Notes"
          depth={0}
          noteCount={allNotesCount}
          isSelected={selection.kind === 'all'}
          hasChildren={false}
          variant="all"
          onPress={() => onSelect({ kind: 'all' })}
          onRequestMenu={(anchor) =>
            openMenuFor({
              folderId: null,
              label: 'All Notes',
              variant: 'all',
              depth: 0,
              includeInNotes: true,
              groupByDate: false,
              anchor,
            })
          }
        />

        {tree.map((node, index) => (
          <FolderSubtree
            key={node.folder.id}
            node={node}
            selection={selection}
            expandedIds={expandedIds}
            isEditing={isEditing}
            canMoveUp={index > 0}
            canMoveDown={index < topLevelIds.length - 1}
            onSelect={onSelect}
            onToggleExpanded={onToggleExpanded}
            onRequestMenu={openMenuFor}
            onMove={onMoveFolder}
          />
        ))}

        {/* Recently Deleted -- always last, and deliberately outside the
            reorderable list rather than pinned by a sort_order the user could
            edit their way past. */}
        <FolderRow
          label="Recently Deleted"
          depth={0}
          noteCount={trashCount}
          isSelected={selection.kind === 'trash'}
          hasChildren={false}
          variant="trash"
          onPress={() => onSelect({ kind: 'trash' })}
          onRequestMenu={(anchor) =>
            openMenuFor({
              folderId: null,
              label: 'Recently Deleted',
              variant: 'trash',
              depth: 0,
              includeInNotes: true,
              groupByDate: false,
              anchor,
            })
          }
        />
      </ScrollView>

      <FolderContextMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        onToggleIncludeInNotes={(t) =>
          t.folderId && onToggleIncludeInNotes(t.folderId, !t.includeInNotes)
        }
        onToggleGroupByDate={(t) => t.folderId && onToggleGroupByDate(t.folderId, !t.groupByDate)}
        onRename={(t) =>
          t.folderId && setDialog({ kind: 'rename', folderId: t.folderId, current: t.label })
        }
        onNewFolder={(t) =>
          setDialog({ kind: 'create', parentId: t.folderId, parentLabel: t.label })
        }
        onDelete={handleDeleteRequest}
      />

      {dialog?.kind === 'create' ? (
        <FolderNameDialog
          title={dialog.parentId ? `New Folder in “${dialog.parentLabel}”` : 'New Folder'}
          initialValue=""
          confirmLabel="Create"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            onCreateFolder(dialog.parentId, name);
          }}
        />
      ) : null}

      {dialog?.kind === 'rename' ? (
        <FolderNameDialog
          title="Rename Folder"
          initialValue={dialog.current}
          confirmLabel="Rename"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            onRenameFolder(dialog.folderId, name);
          }}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteFolderDialog
          folderName={dialog.label}
          noteCount={dialog.noteCount}
          subfolderCount={dialog.subfolderCount}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            onDeleteFolder(dialog.folderId);
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * One folder and, if it is open, everything under it.
 *
 * Recursion rather than a flattened list because the tree is at most five deep
 * by construction -- the depth limit is what makes this safe, and it is
 * enforced in two places (see lib/powersync/folders.ts and the migration).
 */
function FolderSubtree({
  node,
  selection,
  expandedIds,
  isEditing,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggleExpanded,
  onRequestMenu,
  onMove,
}: {
  node: FolderNode;
  selection: FolderSelection;
  expandedIds: Set<string>;
  isEditing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (selection: FolderSelection) => void;
  onToggleExpanded: (folderId: string) => void;
  onRequestMenu: (target: FolderMenuTarget) => void;
  onMove: (folderId: string, direction: -1 | 1) => void;
}) {
  const { folder, noteCount, children } = node;
  const isExpanded = expandedIds.has(folder.id);
  const hasChildren = children.length > 0;

  return (
    <>
      <FolderRow
        label={folder.decryptFailed ? 'Unreadable folder' : folder.name || 'New Folder'}
        depth={folder.depth}
        noteCount={noteCount}
        isSelected={isSameSelection(selection, { kind: 'folder', id: folder.id })}
        isExpanded={isExpanded}
        hasChildren={hasChildren}
        variant={folder.kind === 'skills' ? 'skills' : 'user'}
        // Reordering is top-level only this stage, so the controls only appear
        // on depth 0. A nested folder in edit mode simply behaves normally.
        isEditing={isEditing && folder.depth === 0}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onPress={() => onSelect({ kind: 'folder', id: folder.id })}
        onToggleExpanded={() => onToggleExpanded(folder.id)}
        onMove={(direction) => onMove(folder.id, direction)}
        onRequestMenu={(anchor) =>
          onRequestMenu({
            folderId: folder.id,
            label: folder.name || 'New Folder',
            variant: folder.kind === 'skills' ? 'skills' : 'user',
            depth: folder.depth,
            includeInNotes: folder.includeInNotes,
            groupByDate: folder.groupByDate,
            anchor,
          })
        }
      />

      {isExpanded
        ? children.map((child) => (
            <FolderSubtree
              key={child.folder.id}
              node={child}
              selection={selection}
              expandedIds={expandedIds}
              // Nested rows are never reorderable this stage.
              isEditing={false}
              canMoveUp={false}
              canMoveDown={false}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
              onRequestMenu={onRequestMenu}
              onMove={onMove}
            />
          ))
        : null}
    </>
  );
}

function countDescendants(node: FolderNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

/** Notes in this folder AND everything under it -- what deleting would sweep
 *  into the trash. Deliberately different from the row's displayed count,
 *  which is own-notes-only: the warning has to describe the real blast radius. */
function sumNotes(node: FolderNode): number {
  return node.children.reduce((sum, child) => sum + sumNotes(child), node.noteCount);
}

export { MAX_FOLDER_DEPTH };
