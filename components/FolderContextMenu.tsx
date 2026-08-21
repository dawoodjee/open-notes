import React from 'react';
import { View } from 'react-native';

import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icon';
import {
  Calendar,
  Eye,
  EyeOff,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react-native';
import { MAX_FOLDER_DEPTH } from '@/types/folder';

/**
 * The folder context menu -- long-press on touch, right-click on web/desktop.
 *
 * Controlled (`isOpen` + `onClose`) rather than using Gluestack's own press
 * trigger, because the opening gesture is a LONG press and a right-click,
 * neither of which the built-in trigger knows about. The trigger below is
 * therefore a zero-size anchor positioned where the gesture happened, so the
 * menu appears under the finger or the cursor instead of pinned to the row.
 *
 * WHICH ITEMS EXIST DEPENDS ON THE FOLDER, and the two rules are not the same:
 *
 *   Include in Notes  absent for Recently Deleted -- there is no sense in
 *                     which trash could be "included in Notes".
 *   Rename            hidden for all three default surfaces. Their names are
 *                     identity, not user content: All Notes and Recently
 *                     Deleted are not rows at all, and Skills is found by its
 *                     `kind` flag precisely so a rename could never orphan it.
 */

export interface FolderMenuTarget {
  folderId: string | null;
  label: string;
  /** Which default surface this is, if any. Drives what the menu offers. */
  variant: 'all' | 'trash' | 'skills' | 'user';
  depth: number;
  includeInNotes: boolean;
  groupByDate: boolean;
  anchor: { x: number; y: number };
}

export interface FolderContextMenuProps {
  target: FolderMenuTarget | null;
  onClose: () => void;
  onToggleIncludeInNotes: (target: FolderMenuTarget) => void;
  onRename: (target: FolderMenuTarget) => void;
  onNewFolder: (target: FolderMenuTarget) => void;
  onToggleGroupByDate: (target: FolderMenuTarget) => void;
  onDelete: (target: FolderMenuTarget) => void;
}

export function FolderContextMenu({
  target,
  onClose,
  onToggleIncludeInNotes,
  onRename,
  onNewFolder,
  onToggleGroupByDate,
  onDelete,
}: FolderContextMenuProps) {
  if (!target) return null;

  const isTrash = target.variant === 'trash';
  const isAll = target.variant === 'all';
  const isDefault = target.variant !== 'user';
  const isRealFolder = target.folderId !== null;

  // A sixth level cannot exist, so the item that would create one is disabled
  // rather than hidden -- a missing item reads as a bug, a disabled one
  // explains the limit.
  const canNest = !isRealFolder || target.depth < MAX_FOLDER_DEPTH;

  // `run` closes first, then acts. Acting first leaves the menu open over a
  // dialog it just spawned, and on the delete path the modal ends up behind it.
  const run = (fn: (t: FolderMenuTarget) => void) => () => {
    onClose();
    fn(target);
  };

  return (
    <Menu
      isOpen
      onClose={onClose}
      placement="bottom left"
      className="rounded-2xl p-0 overflow-hidden min-w-[240px]"
      trigger={({ ...triggerProps }) => (
        // A zero-size anchor at the gesture's coordinates. The menu positions
        // itself against this, which is how a context menu ends up under the
        // pointer rather than under the row.
        <View
          {...triggerProps}
          style={{
            position: 'absolute',
            left: target.anchor.x,
            top: target.anchor.y,
            width: 1,
            height: 1,
          }}
        />
      )}
    >
      {!isTrash ? (
        <MenuItem
          key="include"
          textValue="Include in Notes"
          onPress={run(onToggleIncludeInNotes)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon
            as={target.includeInNotes ? Eye : EyeOff}
            className="text-muted-foreground w-[18px] h-[18px]"
          />
          <MenuItemLabel className="text-base text-foreground">
            {target.includeInNotes ? 'Include in Notes' : 'Excluded from Notes'}
          </MenuItemLabel>
        </MenuItem>
      ) : null}

      {!isDefault ? (
        <MenuItem
          key="rename"
          textValue="Rename"
          onPress={run(onRename)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Pencil} className="text-muted-foreground w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-foreground">Rename</MenuItemLabel>
        </MenuItem>
      ) : null}

      <MenuSeparator key="sep-1" />

      <MenuItem
        key="new-folder"
        textValue="New Folder"
        disabled={!canNest}
        onPress={canNest ? run(onNewFolder) : undefined}
        className="px-4 py-3 flex-row items-center gap-3"
      >
        <Icon
          as={FolderPlus}
          className={`w-[18px] h-[18px] ${canNest ? 'text-muted-foreground' : 'text-muted-foreground opacity-40'}`}
        />
        <MenuItemLabel
          className={`text-base ${canNest ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {canNest ? 'New Folder' : `New Folder (${MAX_FOLDER_DEPTH + 1} levels max)`}
        </MenuItemLabel>
      </MenuItem>

      {!isTrash ? (
        <MenuItem
          key="group-by-date"
          textValue="Group By Date"
          onPress={run(onToggleGroupByDate)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Calendar} className="text-muted-foreground w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-foreground">
            Group By Date{target.groupByDate ? ' ✓' : ''}
          </MenuItemLabel>
        </MenuItem>
      ) : null}

      {!isDefault && !isAll ? <MenuSeparator key="sep-2" /> : null}

      {!isDefault && !isAll ? (
        <MenuItem
          key="delete"
          textValue="Delete Folder"
          onPress={run(onDelete)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Trash2} className="text-destructive w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-destructive">Delete Folder</MenuItemLabel>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
