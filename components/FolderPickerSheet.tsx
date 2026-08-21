import React, { useMemo, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Folder as FolderIcon,
  Notebook,
  X,
} from 'lucide-react-native';

import { Modal, ModalBackdrop, ModalContent } from '@/components/ui/modal';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';
import { FolderNameDialog } from './DeleteFolderDialog';
import type { Folder } from '@/types/folder';

/**
 * "Select a Folder" -- the one folder picker every Move goes through.
 *
 * FOUR CALLERS, ONE COMPONENT: swipe-left Move, the context menu's Move,
 * select mode's bulk Move, and (from Stage 12) the note editor's own "..."
 * menu. Three of those exist today; the fourth is the reason this takes a
 * LIST of note ids rather than a single note, and why the header says
 * "N Notes" instead of naming one.
 *
 * WHY A SHEET AND NOT A FLYOUT. Touch gets this modal; desktop gets a nested
 * right-click flyout instead and never renders this component at all -- see
 * desktop-move-folder-selection.png against ipad-move-folder-selection.png.
 * They are structurally different controls, not one control at two sizes.
 *
 * THREE GLUESTACK MODAL TRAPS, all already documented in SettingsDialog and
 * all of which apply here:
 *   1. `bg-background` must be spelled out on ModalContent -- the theme token
 *      doesn't resolve under NativeWind v5-preview and the sheet renders black.
 *   2. No `ModalBody`. It is itself a ScrollView whose className becomes its
 *      own style, so padding never reaches the content.
 *   3. Children are hoisted to an overlay root ABOVE the providers, so
 *      useTheme()/useVault() throw in here. Everything this needs arrives as
 *      props, which is why `folders` is passed in rather than read.
 */

export interface FolderPickerSheetProps {
  isOpen: boolean;
  /** The note's title when one note is moving. null for a bulk move, where
   *  the count line below already says everything there is to say -- passing
   *  "3 Notes" here just printed it twice. */
  label: string | null;
  noteCount: number;
  folders: Folder[];
  /** Greyed out and inert -- a note cannot move into where it already is.
   *
   *  THREE STATES, and the third is the reason this isn't just `string | null`.
   *  A folder id means every note is in that folder. `null` means every note is
   *  UNFILED, which is now a real destination ("All Notes") and so has to be
   *  disabled like any other current folder. `undefined` means the notes are
   *  spread across different folders, in which case nothing is disabled. */
  currentFolderId: string | null | undefined;
  onClose: () => void;
  /** null moves the notes OUT of any folder -- see the All Notes row. */
  onSelect: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string) => void | Promise<void>;
}

export function FolderPickerSheet({
  isOpen,
  label,
  noteCount,
  folders,
  currentFolderId,
  onClose,
  onSelect,
  onCreateFolder,
}: FolderPickerSheetProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState(false);

  // Children keyed by parent. `folders` arrives already ordered by
  // sort_order then created_at, so pushing in array order preserves the same
  // ordering the sidebar shows -- the picker disagreeing with the sidebar
  // about folder order would be its own small bug.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId;
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    return map;
  }, [folders]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows: React.ReactNode[] = [];
  const pushLevel = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf.get(parentId) ?? []) {
      const kids = childrenOf.get(folder.id) ?? [];
      const isOpen = expanded.has(folder.id);
      rows.push(
        <FolderPickerRow
          key={folder.id}
          folder={folder}
          depth={depth}
          hasChildren={kids.length > 0}
          isExpanded={isOpen}
          // A note cannot move into the folder it is already in, and Skills is
          // seeded and found by its `kind` -- filing arbitrary notes into it
          // would make it something other than what it is. Both stay VISIBLE
          // and greyed rather than hidden: a folder missing from the tree
          // reads as a bug, a greyed one explains itself.
          isDisabled={folder.id === currentFolderId || folder.kind === 'skills'}
          onSelect={() => {
            onSelect(folder.id);
            onClose();
          }}
          onToggle={() => toggle(folder.id)}
        />
      );
      // Expanding a disabled folder is still allowed -- you may well be moving
      // a note from a parent into one of its own children.
      if (isOpen) pushLevel(folder.id, depth + 1);
    }
  };
  pushLevel(null, 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full">
      <ModalBackdrop />
      <ModalContent className="w-full max-w-full h-4/5 mt-auto mb-0 mx-0 rounded-t-2xl rounded-b-none border-0 pb-8 bg-background">
        <View className="flex-row items-center px-4 pt-4 pb-2">
          <PressableScale
            onPress={onClose}
            style={{ width: 36, height: 36 }}
            className="rounded-full bg-foreground/10 items-center justify-center"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Icon as={X} className="w-5 h-5 text-foreground" />
          </PressableScale>

          <RNText className="flex-1 text-center text-base font-semibold text-foreground">
            Select a Folder
          </RNText>

          {/* Balances the close button so the title is centred on the sheet
              rather than on the space left over beside it. */}
          <View style={{ width: 36 }} />
        </View>

        <View className="px-5 pb-3">
          {label !== null ? (
            <RNText className="text-base font-semibold text-foreground" numberOfLines={1}>
              {label}
            </RNText>
          ) : null}
          <RNText className="text-sm text-muted-foreground">
            {noteCount} {noteCount === 1 ? 'Note' : 'Notes'}
          </RNText>
        </View>

        <ScrollView className="flex-1 px-4 bg-background" contentContainerStyle={{ paddingBottom: 24 }}>
          <View className="rounded-xl bg-card overflow-hidden">
            {/* ALL NOTES -- the way back OUT of a folder. Unfiled is a real
                state in this app (notes predating folders, notes whose folder
                was deleted), so "no folder" has to be reachable deliberately
                and not only by accident. Sits above New Folder because it is
                a destination that already exists, not one being created. */}
            <PressableScale
              onPress={
                currentFolderId === null
                  ? undefined
                  : () => {
                      onSelect(null);
                      onClose();
                    }
              }
              disabled={currentFolderId === null}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 14,
                opacity: currentFolderId === null ? 0.4 : 1,
              }}
              accessibilityRole="button"
              accessibilityLabel="All Notes"
              accessibilityState={{ disabled: currentFolderId === null }}
            >
              <Icon as={Notebook} className="w-5 h-5 text-lime-600 dark:text-lime-400" />
              <RNText className="text-base text-foreground">All Notes</RNText>
            </PressableScale>

            <View className="h-px bg-border ml-12" />

            <PressableScale
              onPress={() => setNaming(true)}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 14,
              }}
              accessibilityRole="button"
              accessibilityLabel="New Folder"
            >
              <Icon as={FolderPlus} className="w-5 h-5 text-lime-600 dark:text-lime-400" />
              <RNText className="text-base text-lime-600 dark:text-lime-400">New Folder</RNText>
            </PressableScale>

            {rows.length > 0 ? <View className="h-px bg-border ml-12" /> : null}
            {rows}
          </View>
        </ScrollView>

        {naming ? (
          <FolderNameDialog
            title="New Folder"
            initialValue=""
            confirmLabel="Create"
            onCancel={() => setNaming(false)}
            onConfirm={(name) => {
              setNaming(false);
              void onCreateFolder(null, name);
            }}
          />
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function FolderPickerRow({
  folder,
  depth,
  hasChildren,
  isExpanded,
  isDisabled,
  onSelect,
  onToggle,
}: {
  folder: Folder;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: depth * 16 }}>
      <PressableScale
        onPress={isDisabled ? undefined : onSelect}
        disabled={isDisabled}
        containerStyle={{ flex: 1 }}
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 14,
          opacity: isDisabled ? 0.4 : 1,
        }}
        accessibilityRole="button"
        accessibilityLabel={folder.name}
        accessibilityState={{ disabled: isDisabled }}
      >
        <Icon as={FolderIcon} className="w-5 h-5 text-lime-600 dark:text-lime-400 shrink-0" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText className="text-base text-foreground" numberOfLines={1} ellipsizeMode="tail">
            {folder.name}
          </RNText>
        </View>
      </PressableScale>

      {hasChildren ? (
        // A separate hit target from the row, for the same reason FolderRow
        // splits them: tapping the row FILES the note here, tapping the
        // chevron looks inside. Conflating them means you cannot reach a
        // child of a folder without first moving the note into the parent.
        <PressableScale
          onPress={onToggle}
          hitSlop={8}
          style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} ${folder.name}`}
        >
          <Icon
            as={isExpanded ? ChevronDown : ChevronRight}
            className="w-4 h-4 text-muted-foreground"
          />
        </PressableScale>
      ) : (
        <View style={{ width: 44 }} />
      )}
    </View>
  );
}
