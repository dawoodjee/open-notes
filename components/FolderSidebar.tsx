import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';
import { FolderPlus, MoreHorizontal, Power } from 'lucide-react-native';

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
  /** Wide but not persistent -- the iPad-portrait case, where the panel floats
   *  over the content rather than pushing it aside. */
  isOverlay: boolean;
  /** Overlay only: tapping the scrim behind the panel closes it. */
  onDismiss?: () => void;
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
  onSetFolderEnabled: (folderId: string, enabled: boolean) => void;
  onSetSubtreeApiVisibility: (folderId: string, visible: boolean) => void;
  /** Resolved by the parent, which owns the note data the aggregate reads. */
  skillsApiVisibility?: import('@/lib/powersync/folders').SubtreeApiVisibility;
  /** Phones stack the controls above the large title; wide layouts put them
   *  inline with it. See the note on the header below. */
  useCompactHeader: boolean;
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
  isOverlay,
  onDismiss,
  width,
  onSelect,
  onToggleExpanded,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleIncludeInNotes,
  onToggleGroupByDate,
  onMoveFolder,
  onSetFolderEnabled,
  onSetSubtreeApiVisibility,
  skillsApiVisibility,
  useCompactHeader,
}: FolderSidebarProps) {
  const insets = useSafeAreaInsets();
  const [menuTarget, setMenuTarget] = useState<FolderMenuTarget | null>(null);
  const [dialog, setDialog] = useState<PendingDialog>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [isOverflowOpen, setIsOverflowOpen] = useState(false);

  /**
   * Skills is pinned; everything else is the reorderable list.
   *
   * Split here rather than sorted, because "pinned" and "sorted first" are not
   * the same claim: a sort puts it first until a user folder's sort_order
   * happens to beat it, and this must hold regardless of what is in the column.
   * Recently Deleted is pinned the same way -- outside the list entirely rather
   * than by a sort_order the user could edit past.
   *
   * A DISABLED folder drops out of the sidebar here. Its notes are untouched;
   * only the row goes.
   */
  const visibleTree = useMemo(() => tree.filter((n) => n.folder.isEnabled), [tree]);
  const skillsNode = useMemo(
    () => visibleTree.find((n) => n.folder.kind === 'skills') ?? null,
    [visibleTree]
  );
  const reorderable = useMemo(
    () => visibleTree.filter((n) => n.folder.kind !== 'skills'),
    [visibleTree]
  );

  const skillsFolder = useMemo(
    () => tree.find((n) => n.folder.kind === 'skills')?.folder ?? null,
    [tree]
  );

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

  /**
   * New Folder plus the Skills switch.
   *
   * Enable/Disable is here rather than in the Skills row's own context menu on
   * purpose: it is a statement about whether the FEATURE is in use, not about
   * that folder's properties -- and once disabled the row is gone, so a control
   * living on the row would have no way back.
   */
  const overflowMenu = (
    <Menu
      isOpen={isOverflowOpen}
      onOpen={() => setIsOverflowOpen(true)}
      onClose={() => setIsOverflowOpen(false)}
      placement="bottom right"
      offset={8}
      className="rounded-2xl p-0 overflow-hidden min-w-[260px]"
      trigger={({ ...triggerProps }) => (
        <Pressable
          {...triggerProps}
          hitSlop={8}
          style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel="Folder options"
        >
          <Icon as={MoreHorizontal} className="w-6 h-6 text-lime-600 dark:text-lime-400" />
        </Pressable>
      )}
    >
      <MenuItem
        key="new-folder"
        textValue="New Folder"
        onPress={() => {
          setIsOverflowOpen(false);
          setDialog({ kind: 'create', parentId: null, parentLabel: 'Folders' });
        }}
        className="px-4 py-3 flex-row items-center gap-3"
      >
        <Icon as={FolderPlus} className="text-muted-foreground w-[18px] h-[18px]" />
        <MenuItemLabel className="text-base text-foreground">New Folder</MenuItemLabel>
      </MenuItem>

      <MenuSeparator key="sep" />

      <MenuItem
        key="skills-enabled"
        textValue="Skills Folder"
        onPress={() => {
          setIsOverflowOpen(false);
          if (skillsFolder) onSetFolderEnabled(skillsFolder.id, !skillsFolder.isEnabled);
        }}
        className="px-4 py-3 flex-row items-center gap-3"
      >
        <Icon as={Power} className="text-muted-foreground w-[18px] h-[18px]" />
        <MenuItemLabel className="text-base text-foreground">
          {skillsFolder?.isEnabled ? 'Disable Skills Folder' : 'Enable Skills Folder'}
        </MenuItemLabel>
      </MenuItem>
    </Menu>
  );

  const body = (
    <View
      style={{
        paddingTop: isOverlay ? 8 : insets.top,
        ...(width ? { width } : {}),
      }}
      className={`bg-secondary ${
        isOverlay
          ? 'flex-1 rounded-2xl overflow-hidden'
          : isPersistent
            ? 'h-full border-r border-border shrink-0 md:w-72'
            : 'h-full w-full flex-1'
      }`}
    >
      {/*
        Edit on the left, overflow on the right, on both layouts. New Folder
        lives inside the overflow rather than beside it -- a header with one
        action in it and one action next to it invites the question of why, and
        there is no answer.

        The two layouts differ only in where the controls sit relative to the
        title: phones stack them above it, wide layouts run them inline. Same
        controls, same order, so nothing has to be learned twice.
      */}
      {useCompactHeader ? (
        <View className="px-4 pt-4 pb-2">
          <View className="flex-row items-center justify-between mb-2">
            <EditButton isEditing={isEditing} onPress={() => setIsEditing((v) => !v)} />
            {overflowMenu}
          </View>
          <RNText
            className="text-3xl font-bold text-foreground"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            Folders
          </RNText>
        </View>
      ) : (
        <View className="flex-row items-center justify-between px-4 pt-4 pb-2 gap-2">
          <EditButton isEditing={isEditing} onPress={() => setIsEditing((v) => !v)} />
          {/* Truncates rather than clipping. At Android font_scale 1.6 this
              title and the Edit button were both hard-clipped mid-word
              ("Folder", "E") because nothing told either one how to yield. */}
          <RNText
            className="text-lg font-semibold text-foreground flex-1 min-w-0 text-center"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            Folders
          </RNText>
          {overflowMenu}
        </View>
      )}

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

        {/* Pinned: never reorderable, always directly under All Notes. */}
        {skillsNode ? (
          <FolderSubtree
            key={skillsNode.folder.id}
            node={skillsNode}
            selection={selection}
            expandedIds={expandedIds}
            isEditing={false}
            canMoveUp={false}
            canMoveDown={false}
            skillsApiVisibility={skillsApiVisibility}
            onSelect={onSelect}
            onToggleExpanded={onToggleExpanded}
            onRequestMenu={openMenuFor}
            onMove={onMoveFolder}
          />
        ) : null}

        {reorderable.map((node, index) => (
          <FolderSubtree
            key={node.folder.id}
            node={node}
            selection={selection}
            expandedIds={expandedIds}
            isEditing={isEditing}
            canMoveUp={index > 0}
            canMoveDown={index < reorderable.length - 1}
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
        onSetSubtreeApiVisibility={(t, visible) =>
          t.folderId && onSetSubtreeApiVisibility(t.folderId, visible)
        }
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

  if (!isOverlay) return body;

  /**
   * iPad portrait: a floating panel, not a takeover.
   *
   * Inset on every side with the content still visible behind it, matching
   * ipad-portrait-folder-view.jpeg. The scrim is deliberately light -- the
   * point of this presentation is that you can still see where you were, which
   * a heavy dim would defeat. Tapping it dismisses, since a floating panel with
   * no way out but the control that opened it is a trap.
   */
  return (
    <View
      style={{ ...StyleSheet.absoluteFillObject, zIndex: 20 }}
      pointerEvents="box-none"
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close folders"
        className="bg-foreground/10"
      />
      <View
        style={{
          position: 'absolute',
          top: insets.top + 8,
          bottom: insets.bottom + 8,
          left: 8,
          width: 320,
          maxWidth: '85%',
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
        className="rounded-2xl overflow-hidden"
      >
        {body}
      </View>
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
  skillsApiVisibility,
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
  skillsApiVisibility?: import('@/lib/powersync/folders').SubtreeApiVisibility;
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
            apiVisibility: skillsApiVisibility,
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

/** Shared so the two header layouts cannot drift in label or hit area. */
function EditButton({ isEditing, onPress }: { isEditing: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
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
  );
}
