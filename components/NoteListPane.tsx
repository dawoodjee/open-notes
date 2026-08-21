import React, { useRef, useEffect } from 'react';
import { FlatList, Text as RNText, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Pressable } from '@/components/ui/pressable';
import { Input, InputField, InputSlot, InputIcon } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';

// Lucide Icons
import { Search, SquarePen, PanelLeft } from 'lucide-react-native';

// Custom Types & Helpers
import { Note, parseNoteContent, formatNoteDate } from '@/types/note';
import AvatarMenuTrigger from './AvatarMenuTrigger';
import { PressableScale } from './PressableScale';
import { useTheme } from '@/contexts/ThemeContext';
import type { FolderSelection } from '@/types/folder';

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
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onSearchChange: (query: string) => void;
  onOpenFolders?: () => void;
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
  onSelectNote,
  onCreateNote,
  onSearchChange,
  onOpenFolders,
}: NoteListPaneProps) {
  // The bottom bar is one of the few places styled with inline `style` rather
  // than classes (it predates the settings primitives), so its colours can't
  // come from a token and have to be picked here.
  const { scheme } = useTheme();
  const barBackground = scheme === 'dark' ? '#171717' : '#F9FAFB';
  const barBorder = scheme === 'dark' ? '#2e2e2e' : '#E5E7EB';

  // The pane runs edge to edge (NotesLayout no longer insets anything), so the
  // safe area is this pane's own responsibility: the header pads itself past
  // the notch and the bottom bar past the home indicator. The payoff is that
  // this pane's bg-secondary and the bar's own colour now reach the physical
  // edge of the screen instead of stopping at a differently-coloured strip.
  const insets = useSafeAreaInsets();

  const activeNotes = notes.filter((n) => !n.isTrashed);

  /**
   * SEARCHING AND BROWSING ARE DIFFERENT QUESTIONS, and this is where they
   * part company.
   *
   * Browsing asks "what is filed here", so it honours the folder selection and
   * the Include-in-Notes exclusions. Searching asks "where is the note that
   * says X", and a note the user cannot find by searching for it is a lost
   * note -- so search deliberately ignores BOTH filters and looks at every
   * non-trashed note, wherever it lives.
   *
   * That is the recorded decision ("Include in Notes excludes from All Notes
   * only, not search") and it is the reason this is two expressions rather
   * than one chained filter.
   */
  const isSearching = searchQuery.trim().length > 0;

  const browsableNotes = activeNotes.filter((n) => {
    if (selection.kind === 'folder') {
      return n.folderId !== null && visibleFolderIds?.has(n.folderId) === true;
    }
    // All Notes: unfiled notes always show; filed ones only if their folder
    // is included.
    return n.folderId === null || !excludedFolderIds.has(n.folderId);
  });

  const needle = searchQuery.toLowerCase();
  const filteredNotes = isSearching
    ? activeNotes.filter(
        (n) =>
          n.body.toLowerCase().includes(needle) || n.title.toLowerCase().includes(needle)
      )
    : browsableNotes;

  const listRef = useRef<FlatList<Note>>(null);
  const hasRestoredScroll = useRef<boolean>(false);

  // Scroll the restored note into view once, on first load only — afterwards the
  // user's own scrolling is left alone.
  useEffect(() => {
    if (hasRestoredScroll.current || !selectedNoteId || filteredNotes.length === 0) {
      return;
    }

    const index = filteredNotes.findIndex((n) => n.id === selectedNoteId);
    if (index < 0) return;

    hasRestoredScroll.current = true;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
  }, [selectedNoteId, filteredNotes]);

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
      {/* Header with Top-Right Avatar for Mobile/List view */}
      <HStack
        className="justify-between items-start p-4 pb-2"
        style={{ paddingTop: insets.top + 16 }}
      >
        {/* flex-1/min-w-0 as CLASSES, not as an inline style. NativeWind
            compiles className into its own `style` prop, which overwrites any
            `style` passed beside it -- the same collision documented in
            PressableScale. Passed as a style, this flex was silently dropped
            and the title overflowed straight across the avatar at
            accessibility text sizes. */}
        <HStack className="flex-1 min-w-0 items-center gap-2">
          {onOpenFolders ? (
            // Mobile only: the folder pane is a separate screen there, so the
            // list needs a way back to it. On desktop both panes are visible
            // at once and this would be a button to somewhere you already are.
            <Pressable
              onPress={onOpenFolders}
              hitSlop={8}
              className="md:hidden"
              style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
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
              // adjustsFontSizeToFit would be the wrong fix here -- it defeats
              // the whole point of Dynamic Type by shrinking text the user
              // asked to be bigger. Truncating a folder name is the honest
              // failure; the full name is one tap away in the sidebar.
              ellipsizeMode="tail"
            >
              {isSearching ? 'Search' : folderTitle}
            </RNText>
            <RNText className="text-xs text-muted-foreground font-medium mt-0.5">
              {isSearching
                ? `${filteredNotes.length} ${filteredNotes.length === 1 ? 'Result' : 'Results'}`
                : `${filteredNotes.length} ${filteredNotes.length === 1 ? 'Note' : 'Notes'}`}
            </RNText>
          </VStack>
        </HStack>

        {/* Mobile/List Avatar. shrink-0 is load-bearing at accessibility text
            sizes: without it the title -- which is text-3xl and therefore
            enormous once Dynamic Type scales it -- squeezes the avatar to zero
            width and then draws straight over it. */}
        <AvatarMenuTrigger className="md:hidden shrink-0" />
      </HStack>

      {/* Notes Scroll Area */}
      <FlatList
        ref={listRef}
        data={filteredNotes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4 }}
        // Rows are virtualized, so the target may not be measured yet — nudge
        // toward it with an estimate, then retry once layout settles.
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({
            offset: index * averageItemLength,
            animated: false,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
          }, 100);
        }}
        renderItem={({ item: note }) => {
          const { title, preview } = parseNoteContent(note.body);
          const isSelected = note.id === selectedNoteId;

          return (
            <PressableScale
              onPress={() => onSelectNote(note.id)}
              className={`p-3 mb-2 rounded-xl ${
                isSelected
                  ? 'bg-lime-100/80 dark:bg-lime-900/40'
                  : 'bg-card border border-border'
              }`}
            >
              <RNText className="font-semibold text-base text-foreground" numberOfLines={1}>
                {title}
              </RNText>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 4,
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <RNText
                  className="text-xs text-muted-foreground font-medium"
                  style={{ flexShrink: 0 }}
                >
                  {formatNoteDate(new Date(note.updatedAt))}
                  {"  "}
                </RNText>

                <RNText
                  className="text-xs text-muted-foreground"
                  style={{ flex: 1, minWidth: 0 }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {preview}
                </RNText>
              </View>
            </PressableScale>
          );
        }}
      />

      {/* Bottom Controls */}
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
        <Input className="flex-1 rounded-full bg-background border-border h-10 px-3">
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
    </VStack>
  );
}
