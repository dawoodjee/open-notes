import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SectionList, Text as RNText, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Pressable } from '@/components/ui/pressable';
import { Input, InputField, InputSlot, InputIcon } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel } from '@/components/ui/menu';

// Lucide Icons
import { Search, SquarePen, PanelLeft, ChevronLeft, Check } from 'lucide-react-native';

// Custom Types & Helpers
import { Note, parseNoteContent } from '@/types/note';
import AvatarMenuTrigger from './AvatarMenuTrigger';
import { PressableScale } from './PressableScale';
import { DialogOverlay } from './DialogOverlay';
import { HeaderCircleButton } from './HeaderCircleButton';
import { NoteRow } from './NoteRow';
import { SwipeableNoteRow } from './SwipeableNoteRow';
import { NoteContextMenu, type NoteMenuTarget } from './NoteContextMenu';
import { FolderPickerSheet } from './FolderPickerSheet';
import { buildNoteSections, type NoteSection } from '@/lib/notes/grouping';
import { useTheme } from '@/contexts/ThemeContext';
import type { Folder, FolderSelection } from '@/types/folder';

export interface NoteListPaneProps {
  notes: Note[];
  selectedNoteId: string | null;
  searchQuery: string;
  isSidebarTucked: boolean;
  sidebarWidth: number;
  /** What the folder sidebar has selected. Decides the title and the filter. */
  selection: FolderSelection;
  /** Title for the current folder -- decrypted upstream, since names are
   *  ciphertext at rest and this pane never touches the key. */
  folderTitle: string;
  /** Folders with Include in Notes off. Excluded from All Notes, and from
   *  nothing else -- notably NOT from search. */
  excludedFolderIds: Set<string>;
  /** The selected folder plus all of its descendants. Selecting a folder shows
   *  everything underneath it, which is why this is a set rather than one id. */
  visibleFolderIds: Set<string> | null;
  /** Every folder, decrypted. Feeds the per-row folder line and the picker --
   *  folders.name is ciphertext, so neither can come from SQL. */
  folders: Folder[];
  /** The current surface's Group By Date setting, resolved upstream. */
  groupByDate: boolean;
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onSearchChange: (query: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** folderId null moves the notes out of any folder, into All Notes. */
  onMoveNotes: (ids: string[], folderId: string | null) => void;
  onTrashNotes: (ids: string[]) => void;
  onDuplicateNote: (id: string) => void;
  onShareNote: (id: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => void | Promise<void>;
  /** Supplied on narrow layouts only. Its presence IS the "am I a phone?"
   *  signal for the header shape above. */
  onOpenFolders?: () => void;
  /** Wide layouts only: collapse/expand the persistent folder pane. */
  onToggleSidebar?: () => void;
  /** True on phones. Decides the header shape -- see the note on the header. */
  useCompactHeader: boolean;
}

export default function NoteListPane({
  notes,
  selectedNoteId,
  searchQuery,
  isSidebarTucked,
  sidebarWidth,
  selection,
  folderTitle,
  excludedFolderIds,
  visibleFolderIds,
  folders,
  groupByDate,
  onSelectNote,
  onCreateNote,
  onSearchChange,
  onTogglePin,
  onMoveNotes,
  onTrashNotes,
  onDuplicateNote,
  onShareNote,
  onCreateFolder,
  onOpenFolders,
  onToggleSidebar,
  useCompactHeader,
}: NoteListPaneProps) {
  // The bottom bar is one of the few places styled with inline `style` rather
  // than classes (it predates the settings primitives), so its colours can't
  // come from a token and have to be picked here.
  const { scheme } = useTheme();
  const barBackground = scheme === 'dark' ? '#171717' : '#F9FAFB';
  const barBorder = scheme === 'dark' ? '#2e2e2e' : '#E5E7EB';

  // The pane runs edge to edge (NotesLayout no longer insets anything), so the
  // safe area is this pane's own responsibility: the header pads itself past
  // the notch and the bottom bar past the home indicator.
  const insets = useSafeAreaInsets();

  /**
   * SEARCHING AND BROWSING ARE DIFFERENT QUESTIONS, and this is where they
   * part company.
   *
   * Browsing asks "what is filed here", so it honours the folder selection and
   * the Include-in-Notes exclusions. Searching asks "where is the note that
   * says X", and a note the user cannot find by searching for it is a lost
   * note -- so search deliberately ignores BOTH filters and looks at every
   * non-trashed note, wherever it lives.
   */
  const isSearching = searchQuery.trim().length > 0;

  // Memoised as a block in Stage 11. This used to run unmemoised on every
  // render, which was affordable when the result was fed straight to a
  // FlatList; it is not once grouping, folder-name resolution and a selection
  // set all hang off it and a keystroke re-renders the pane.
  const filteredNotes = useMemo(() => {
    const activeNotes = notes.filter((n) => !n.isTrashed);
    if (isSearching) {
      const needle = searchQuery.toLowerCase();
      return activeNotes.filter(
        (n) =>
          n.body.toLowerCase().includes(needle) || n.title.toLowerCase().includes(needle)
      );
    }
    return activeNotes.filter((n) => {
      if (selection.kind === 'folder') {
        return n.folderId !== null && visibleFolderIds?.has(n.folderId) === true;
      }
      // All Notes: unfiled notes always show; filed ones only if their folder
      // is included.
      return n.folderId === null || !excludedFolderIds.has(n.folderId);
    });
  }, [notes, isSearching, searchQuery, selection, visibleFolderIds, excludedFolderIds]);

  // Search results are a flat list, matching the reference: buckets answer
  // "when did I write this", and someone who has just typed a word is asking
  // something else entirely.
  const sections = useMemo(
    () => buildNoteSections(filteredNotes, { groupByDate: groupByDate && !isSearching }),
    [filteredNotes, groupByDate, isSearching]
  );

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders) map.set(f.id, f.name);
    return map;
  }, [folders]);

  // The folder line answers "which folder is this in", which is only a
  // question in All Notes -- inside a folder every row gives the same answer,
  // and during a search the answer is genuinely useful again.
  const showFolderLine = selection.kind === 'all' || isSearching;

  // --- Interaction state ---------------------------------------------------

  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<NoteMenuTarget | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  /** Which note ids a pending Move is for. Empty = the picker is closed. */
  const [moveTargets, setMoveTargets] = useState<string[]>([]);
  /** Desktop only: the Move flyout's anchor, once Move is picked. */
  const [moveFlyoutAnchor, setMoveFlyoutAnchor] = useState<{ x: number; y: number } | null>(null);

  const isDesktop = Platform.OS === 'web';

  // Leaving select mode has to drop the selection too. Keeping it "in case
  // they come back" means re-entering select mode silently arrives with notes
  // already ticked, and the first bulk Delete takes more than the user chose.
  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleChecked = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startMove = useCallback(
    (ids: string[], anchor?: { x: number; y: number }) => {
      if (ids.length === 0) return;
      if (isDesktop && anchor) setMoveFlyoutAnchor(anchor);
      setMoveTargets(ids);
    },
    [isDesktop]
  );

  const finishMove = useCallback(
    (folderId: string | null) => {
      onMoveNotes(moveTargets, folderId);
      setMoveTargets([]);
      setMoveFlyoutAnchor(null);
      exitSelectMode();
    },
    [moveTargets, onMoveNotes, exitSelectMode]
  );

  const cancelMove = useCallback(() => {
    setMoveTargets([]);
    setMoveFlyoutAnchor(null);
  }, []);

  const noteById = useCallback(
    (id: string) => filteredNotes.find((n) => n.id === id) ?? null,
    [filteredNotes]
  );

  // --- Scroll restore ------------------------------------------------------

  const listRef = useRef<SectionList<Note, NoteSection>>(null);
  const hasRestoredScroll = useRef<boolean>(false);

  // Scroll the restored note into view once, on first load only. Moved from
  // scrollToIndex to scrollToLocation with the section list -- and note the
  // itemIndex is deliberately NOT offset by one: SectionList counts the header
  // as item 0 only when a header is rendered, which is why this goes through
  // the same section array the list does rather than a flattened copy.
  useEffect(() => {
    if (hasRestoredScroll.current || !selectedNoteId || sections.length === 0) return;

    for (let s = 0; s < sections.length; s += 1) {
      const i = sections[s].data.findIndex((n) => n.id === selectedNoteId);
      if (i < 0) continue;
      hasRestoredScroll.current = true;
      listRef.current?.scrollToLocation({
        sectionIndex: s,
        itemIndex: i,
        viewPosition: 0.5,
        animated: false,
      });
      return;
    }
  }, [selectedNoteId, sections]);

  // --- Header --------------------------------------------------------------

  const selectedCount = selectedIds.size;
  const headline = isSelectMode
    ? selectedCount > 0
      ? `${selectedCount} Selected`
      : folderTitle
    : isSearching
      ? 'Search'
      : folderTitle;

  // The subtitle is ALWAYS the total, even while selecting -- both reference
  // shots show "179 Notes" underneath, whether nothing or something is
  // selected. It is the size of the pile you are choosing from, and swapping
  // it for the selection count would say the same thing twice.
  const subtitle = isSearching
    ? `${filteredNotes.length} ${filteredNotes.length === 1 ? 'Result' : 'Results'}`
    : `${filteredNotes.length} ${filteredNotes.length === 1 ? 'Note' : 'Notes'}`;

  return (
    <VStack
      style={
        Platform.OS === 'web' && !isSidebarTucked && selectedNoteId
          ? { width: sidebarWidth }
          : undefined
      }
      className={`
        border-r border-border bg-secondary shrink-0
        ${selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
        ${isSidebarTucked ? 'md:hidden' : 'md:w-80'}
      `}
    >
      {/*
        TWO HEADER SHAPES, because a phone and a split view are answering
        different questions.

        `onOpenFolders` is only supplied when the folder pane is NOT persistent
        -- i.e. on a phone, and on an iPad in portrait -- so it doubles as the
        signal for which shape to draw.
      */}
      <VStack className="p-4 pb-2" style={{ paddingTop: insets.top + 16 }}>
        {useCompactHeader && onOpenFolders ? (
          <HStack className="justify-between items-center mb-2">
            {/* In select mode the back button would leave a selection stranded
                behind you, so the row swaps to the Done control instead --
                which is also where the reference puts it. */}
            {isSelectMode ? (
              <View />
            ) : (
              <HeaderCircleButton
                icon={ChevronLeft}
                accessibilityLabel="Back to folders"
                onPress={onOpenFolders}
              />
            )}
            {isSelectMode ? (
              <DoneButton onPress={exitSelectMode} />
            ) : (
              <AvatarMenuTrigger
                className="shrink-0"
                onSelectNotes={() => setIsSelectMode(true)}
              />
            )}
          </HStack>
        ) : null}

        <HStack className="items-start justify-between">
          <HStack className="flex-1 min-w-0 items-center gap-2">
            {!useCompactHeader ? (
              // WIDE LAYOUT (iPad both orientations, desktop): the reveal
              // control, INLINE with the title rather than stacked above it.
              <Pressable
                onPress={onOpenFolders ?? onToggleSidebar}
                hitSlop={8}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityRole="button"
                accessibilityLabel="Show folders"
              >
                <Icon as={PanelLeft} className="w-6 h-6 text-foreground" />
              </Pressable>
            ) : null}

            <VStack className="flex-1 min-w-0">
              <RNText
                className="text-3xl font-bold text-foreground"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {headline}
              </RNText>
              <RNText className="text-xs text-muted-foreground font-medium mt-0.5">
                {subtitle}
              </RNText>
            </VStack>
          </HStack>

          {!useCompactHeader ? (
            isSelectMode ? (
              <DoneButton onPress={exitSelectMode} />
            ) : (
              <AvatarMenuTrigger
                variant="overflow"
                className="shrink-0"
                onSelectNotes={() => setIsSelectMode(true)}
              />
            )
          ) : null}
        </HStack>
      </VStack>

      {/* Notes Scroll Area */}
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingVertical: 4,
          // Room for the floating bulk pills, which sit OVER the list rather
          // than pushing it up -- without this the last row is unreachable
          // under them.
          paddingBottom: isSelectMode ? 88 : 4,
        }}
        onScrollBeginDrag={() => setOpenSwipeId(null)}
        // NOT OPTIONAL, and it is a hard error rather than a warning:
        // scrollToLocation goes through scrollToIndex underneath, and a
        // virtualized list refuses to jump to a row it has never measured
        // unless it is told how to recover. Rows here are variable height
        // (two lines or three, taller again under Dynamic Type), so
        // getItemLayout is not available -- this is the other half of that
        // pair. Same shape as the FlatList handler this replaced.
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.getScrollResponder()?.scrollTo({
            y: index * averageItemLength,
            animated: false,
          });
        }}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={{ paddingTop: 16, paddingBottom: 6 }}>
              <RNText className="text-xl font-bold text-foreground">{section.title}</RNText>
              {/* Desktop draws a rule under the group label that starts at the
                  LABEL's left edge, further left than the rows' text -- see
                  desktop-date-group-separator.png. On a phone the group is a
                  card instead and the header floats above it with no rule. */}
              {useCompactHeader ? null : <View className="h-px bg-border mt-1.5" />}
            </View>
          ) : (
            <View style={{ height: 4 }} />
          )
        }
        renderItem={({ item, index, section }) => {
          const isLast = index === section.data.length - 1;
          const row = (
            <NoteRow
              note={item}
              isOpen={item.id === selectedNoteId}
              folderName={
                showFolderLine && item.folderId
                  ? (folderNameById.get(item.folderId) ?? null)
                  : null
              }
              variant={useCompactHeader ? 'card' : 'flat'}
              isFirstInSection={index === 0}
              isLastInSection={isLast}
              isSelectMode={isSelectMode}
              isChecked={selectedIds.has(item.id)}
              onPress={() =>
                isSelectMode ? toggleChecked(item.id) : onSelectNote(item.id)
              }
              onLongPress={
                isSelectMode
                  ? undefined
                  : (anchor) =>
                      setMenuTarget({
                        noteId: item.id,
                        title: parseNoteContent(item.body).title,
                        isPinned: item.isPinned,
                        anchor,
                      })
              }
            />
          );

          // Swipe is suppressed while selecting: the gesture would fight the
          // tap-to-tick, and Apple drops it in select mode for the same reason.
          if (isSelectMode) return row;

          return (
            <SwipeableNoteRow
              id={item.id}
              isPinned={item.isPinned}
              openId={openSwipeId}
              onOpenChange={setOpenSwipeId}
              onPin={() => onTogglePin(item.id, !item.isPinned)}
              onShare={() => onShareNote(item.id)}
              onMove={() => startMove([item.id])}
              onDelete={() => onTrashNotes([item.id])}
            >
              {row}
            </SwipeableNoteRow>
          );
        }}
      />

      {/* Floating bulk actions. Docked over the list, laid out for TWO --
          Apple's third pill is Tags, which is an iteration-3 feature, so the
          slot is not backfilled with something else. */}
      {isSelectMode ? (
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 16 + insets.bottom,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
          pointerEvents="box-none"
        >
          <BulkPill
            label={selectedCount > 0 ? 'Move' : 'Move All'}
            onPress={() =>
              startMove(
                selectedCount > 0 ? [...selectedIds] : filteredNotes.map((n) => n.id)
              )
            }
          />
          <BulkPill
            label={selectedCount > 0 ? 'Delete' : 'Delete All'}
            onPress={() => setConfirmBulkDelete(true)}
          />
        </View>
      ) : null}

      {/* Bottom Controls.
          Search and New Note stay here for now on every platform. The
          reference removes them from wide layouts, but Stage 12 is what
          relocates them into the editor chrome -- taking them away first would
          leave desktop and iPad with no way to make a note at all.

          HIDDEN WHILE SELECTING, for two reasons that happen to agree: the
          floating bulk pills dock to the bottom and would otherwise land on
          top of this bar, and neither control means anything mid-selection --
          searching would change the list out from under a selection, and
          creating a note during one is incoherent. The reference shows no
          bottom bar in select mode either. */}
      {isSelectMode ? null : (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 12,
          paddingBottom: 12 + insets.bottom,
          gap: 12,
          backgroundColor: barBackground,
          borderTopWidth: 1,
          borderTopColor: barBorder,
          width: '100%',
        }}
      >
        {/* minHeight, not a fixed h-10. The placeholder and value scale with
            Dynamic Type, and at accessibility sizes a fixed 40pt box clipped
            the text through the middle -- visible in the Android font_scale
            1.6 screenshot. The New Note button beside it KEEPS its fixed 40pt
            circle on purpose: it holds an icon, and icons do not scale, so
            growing it would just make a bigger circle around the same glyph.
            alignItems:'center' on the row keeps the two optically aligned as
            the field grows. */}
        <Input
          className="flex-1 rounded-full bg-background border-border px-3"
          style={{ minHeight: 40 }}
        >
          <InputSlot>
            <InputIcon as={Search} className="text-muted-foreground ml-1 shrink-0" />
          </InputSlot>
          <InputField
            placeholder="Search"
            value={searchQuery}
            onChangeText={onSearchChange}
            className="text-sm text-foreground flex-1 min-w-0"
          />
        </Input>

        <Pressable
          onPress={onCreateNote}
          className="w-10 h-10 rounded-full bg-lime-500 items-center justify-center active:bg-lime-600 shadow-sm shrink-0"
        >
          <Icon as={SquarePen} className="text-on-accent w-5 h-5" />
        </Pressable>
      </View>
      )}

      <NoteContextMenu
        target={menuTarget}
        variant={isDesktop ? 'desktop' : 'touch'}
        onClose={() => setMenuTarget(null)}
        onShare={(t) => onShareNote(t.noteId)}
        onMove={(t) => startMove([t.noteId], t.anchor)}
        onDelete={(t) => onTrashNotes([t.noteId])}
        onTogglePin={(t) => onTogglePin(t.noteId, !t.isPinned)}
        onDuplicate={(t) => onDuplicateNote(t.noteId)}
      />

      {/* TWO PICKERS, ONE FOR EACH INPUT DEVICE. Touch gets the modal sheet;
          desktop gets a flyout anchored where the click was. They are not the
          same control resized -- see the two reference shots. */}
      {moveTargets.length > 0 && isDesktop && moveFlyoutAnchor ? (
        <DesktopMoveFlyout
          anchor={moveFlyoutAnchor}
          folders={folders}
          currentFolderId={sharedFolderId(moveTargets, noteById)}
          onClose={cancelMove}
          onSelect={finishMove}
        />
      ) : null}

      {moveTargets.length > 0 && !isDesktop ? (
        <FolderPickerSheet
          isOpen
          label={
            moveTargets.length === 1
              ? parseNoteContent(noteById(moveTargets[0])?.body ?? '').title
              : null
          }
          noteCount={moveTargets.length}
          folders={folders}
          currentFolderId={sharedFolderId(moveTargets, noteById)}
          onClose={cancelMove}
          onSelect={finishMove}
          onCreateFolder={onCreateFolder}
        />
      ) : null}

      {confirmBulkDelete ? (
        <ConfirmBulkDelete
          count={selectedCount > 0 ? selectedCount : filteredNotes.length}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={() => {
            onTrashNotes(
              selectedCount > 0 ? [...selectedIds] : filteredNotes.map((n) => n.id)
            );
            setConfirmBulkDelete(false);
            exitSelectMode();
          }}
        />
      ) : null}
    </VStack>
  );
}

/**
 * The folder every target note is already in, or null if they disagree.
 *
 * Only a folder ALL of them share can be greyed out -- greying a folder that
 * merely some of them are in would block a move that is perfectly valid for
 * the rest.
 */
/**
 * The one folder every one of these notes is in, or `undefined` if they differ.
 *
 * THE UNDEFINED MATTERS. This used to return `null` for two different facts --
 * "these notes disagree" and "these notes are all unfiled" -- which was
 * harmless only while `null` could never be a Move destination. All Notes made
 * it one. Collapsing them again would enable All Notes for a set of notes that
 * are already unfiled, and disable it for a mixed set where it is exactly the
 * right answer. Three states, three values.
 */
function sharedFolderId(
  ids: string[],
  lookup: (id: string) => Note | null
): string | null | undefined {
  let shared: string | null | undefined;
  let seen = false;
  for (const id of ids) {
    const folderId = lookup(id)?.folderId ?? null;
    if (!seen) {
      shared = folderId;
      seen = true;
    } else if (shared !== folderId) return undefined;
  }
  return seen ? shared : undefined;
}

/**
 * Exit multi-select. A translucent circle with a plain checkmark, NOT an
 * accent-filled one -- both reference shots draw it the same way the back
 * button is drawn, and it means "I'm finished here" rather than "confirm".
 *
 * Local and disposable by design: Stage 12 owns the shared icon-button
 * primitive, and this is on its conversion list.
 */
function DoneButton({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={8}
      containerStyle={{ width: 36, height: 36 }}
      style={{ width: 36, height: 36 }}
      className="rounded-full bg-foreground/10 items-center justify-center"
      accessibilityRole="button"
      accessibilityLabel="Done selecting"
    >
      <Icon as={Check} className="w-5 h-5 text-foreground" />
    </PressableScale>
  );
}

/** A floating bulk-action capsule. Local; Stage 12's conversion list. */
function BulkPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 24, justifyContent: 'center' }}
      // bg-foreground/10, not bg-secondary: `secondary` in dark mode is within
      // a few points of the pane behind it, so the capsule vanished and the
      // pills read as bare floating words. A tenth of the text colour is the
      // same translucent trick HeaderCircleButton uses, and it lands as a
      // visible capsule against either theme without a new palette entry.
      className="rounded-full bg-foreground/10 border border-border"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <RNText className="text-base font-semibold text-foreground">{label}</RNText>
    </PressableScale>
  );
}

/**
 * Bulk delete confirms; single delete does not.
 *
 * That asymmetry is deliberate and matches the spec: one note going to trash
 * is obvious and one tap from being restored, whereas forty notes disappearing
 * at once is neither.
 */
function ConfirmBulkDelete({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogOverlay onDismiss={onCancel}>
      <View className="w-full max-w-sm rounded-2xl bg-background p-6">
        <RNText className="text-lg font-semibold text-foreground mb-2">
          Delete {count} {count === 1 ? 'Note' : 'Notes'}?
        </RNText>
        <RNText className="text-sm text-muted-foreground mb-5">
          They move to Recently Deleted and are removed permanently after 30 days.
        </RNText>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <PressableScale
            onPress={onCancel}
            containerStyle={{ flex: 1 }}
            style={{ minHeight: 48 }}
            className="rounded-2xl items-center justify-center bg-secondary"
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <RNText className="text-foreground font-medium">Cancel</RNText>
          </PressableScale>
          <PressableScale
            onPress={onConfirm}
            containerStyle={{ flex: 1 }}
            style={{ minHeight: 48 }}
            className="rounded-2xl items-center justify-center bg-red-500"
            accessibilityRole="button"
            accessibilityLabel="Delete"
          >
            <RNText className="text-on-accent font-semibold">Delete</RNText>
          </PressableScale>
        </View>
      </View>
    </DialogOverlay>
  );
}

/**
 * Desktop's Move target picker: a flyout, not a sheet.
 *
 * Flat list with indentation standing in for nesting, exactly as
 * desktop-move-folder-selection.png draws it -- macOS does not nest a further
 * submenu per level, it shows the whole tree indented in one panel. Anchored
 * at the pointer via the same zero-size-anchor trick the context menus use.
 */
function DesktopMoveFlyout({
  anchor,
  folders,
  currentFolderId,
  onClose,
  onSelect,
}: {
  anchor: { x: number; y: number };
  folders: Folder[];
  currentFolderId: string | null | undefined;
  onClose: () => void;
  onSelect: (folderId: string | null) => void;
}) {
  const ordered: { folder: Folder; depth: number }[] = [];
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId);
    if (list) list.push(f);
    else byParent.set(f.parentId, [f]);
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      ordered.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <Menu
      isOpen
      onClose={onClose}
      placement="bottom left"
      className="rounded-2xl p-0 overflow-hidden min-w-[240px]"
      trigger={({ ...triggerProps }) => (
        <View
          {...triggerProps}
          style={{ position: 'absolute', left: anchor.x, top: anchor.y, width: 1, height: 1 }}
        />
      )}
    >
      {/* All Notes: the way back out of a folder. Same reasoning as the
          sheet's row -- see FolderPickerSheet. */}
      <MenuItem
        key="__all__"
        textValue="All Notes"
        onPress={
          currentFolderId === null
            ? undefined
            : () => {
                onClose();
                onSelect(null);
              }
        }
        className="px-4 py-2.5"
      >
        <MenuItemLabel
          className={`text-base ${
            currentFolderId === null ? 'text-muted-foreground opacity-50' : 'text-foreground'
          }`}
        >
          All Notes
        </MenuItemLabel>
      </MenuItem>

      {ordered.map(({ folder, depth }) => {
        const disabled = folder.id === currentFolderId || folder.kind === 'skills';
        return (
          <MenuItem
            key={folder.id}
            textValue={folder.name}
            onPress={
              disabled
                ? undefined
                : () => {
                    onClose();
                    onSelect(folder.id);
                  }
            }
            className="px-4 py-2.5"
            style={{ paddingLeft: 16 + depth * 14 }}
          >
            <MenuItemLabel
              className={`text-base ${disabled ? 'text-muted-foreground opacity-50' : 'text-foreground'}`}
            >
              {folder.name}
            </MenuItemLabel>
          </MenuItem>
        );
      })}
    </Menu>
  );
}
