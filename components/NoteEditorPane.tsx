import React, { useRef } from 'react';
import {
  Text as RNText,
  PanResponder,
  Keyboard,
  Platform,
  // The API, not the lucide glyph of the same name imported below. Built into
  // React Native, so sharing needs no new dependency.
  Share as RNShare,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RichEditor from './RichEditor';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { Box } from '@/components/ui/box';

import {
  Menu as UIComponentsMenu,
  MenuItem,
  MenuItemLabel,
  MenuSeparator,
} from '@/components/ui/menu';

// Lucide Icons
import {
  ChevronLeft,
  Share,
  Menu,
  Trash2,
  MoreVertical,
  Eye,
  EyeOff,
} from 'lucide-react-native';

// Custom Types
import { Note, noteToPlainText } from '@/types/note';
import AvatarMenuTrigger from './AvatarMenuTrigger';
import { useApiGateOpen } from '@/lib/plaintext/useApiGate';

export interface NoteEditorPaneProps {
  selectedNote: Note | undefined;
  selectedNoteId: string | null;
  isSidebarTucked: boolean;
  onToggleSidebar: () => void;
  onBackToList: () => void;
  onTrashNote: (id: string) => void;
  onSetHiddenFromApi: (id: string, hidden: boolean) => void;
  onNoteChange: (html: string) => void;
  initialEditorScrollOffset?: number;
  onEditorScrollOffsetChange?: (offset: number) => void;
}

/**
 * Whether a software keyboard is currently on screen.
 *
 * The two platforms fire different events and only one pair is reliable on
 * each: iOS gets `keyboardWillShow`/`keyboardWillHide`, which fire with the
 * animation and so keep the layout in step with it, while Android only has the
 * `did` variants.
 */
function useKeyboardShown() {
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const subs = [
      Keyboard.addListener(showEvent, () => setShown(true)),
      Keyboard.addListener(hideEvent, () => setShown(false)),
    ];

    return () => subs.forEach((s) => s.remove());
  }, []);

  return shown;
}

export default function NoteEditorPane({
  selectedNote,
  selectedNoteId,
  isSidebarTucked,
  onToggleSidebar,
  onBackToList,
  onTrashNote,
  onSetHiddenFromApi,
  onNoteChange,
  initialEditorScrollOffset,
  onEditorScrollOffsetChange,
}: NoteEditorPaneProps) {
  // Live, because the gate is toggled in a settings sheet with no component
  // ancestry to this menu -- see useApiGateOpen.
  const apiGateOpen = useApiGateOpen();

  // This pane runs edge to edge, so it pads its own chrome past the notch and
  // the home indicator. See the comment on NotesLayout's root view.
  const insets = useSafeAreaInsets();

  // The bottom inset is dropped while the keyboard is up, and that is not a
  // detail. The home indicator is only there to avoid when nothing else is:
  // once the keyboard covers that part of the screen, reserving space for the
  // indicator as well leaves a dead band sitting between the text and the keys.
  // iOS itself makes exactly this swap.
  const keyboardShown = useKeyboardShown();
  const editorBottomInset = keyboardShown ? 0 : insets.bottom;

  // Named here rather than inlined twice, because `textValue` (what a screen
  // reader and react-aria's typeahead use) and the visible label must not be
  // able to drift apart.
  const visibilityLabel = selectedNote?.isHiddenFromApi
    ? 'Invisible to Apps'
    : 'Visible to Apps';

  /**
   * Hand the note to the system share sheet as plain text.
   *
   * NOT routed through the plaintext broker or the API gate in lib/plaintext.
   * Those govern OTHER SOFTWARE reading notes on its own -- a background
   * request the user is not present for. This is the user exporting their own
   * note by hand, choosing the recipient in a system sheet they raised, which
   * is the same category as reading it on screen. Gating it would ask
   * permission for something already being done deliberately.
   *
   * Plain text rather than the stored HTML: the destination is Messages, Mail
   * or another notes app, and tags would arrive as literal angle brackets.
   *
   * Nothing is reported back. A share that fails is almost always the user
   * dismissing the sheet, and React Native does not reliably distinguish that
   * from a real error across platforms -- so an alert here would mostly fire
   * on "changed my mind", which is the one case that must stay silent.
   */
  async function handleShare() {
    if (!selectedNote) return;
    const body = noteToPlainText(selectedNote.body);
    if (!body) return;

    try {
      // `title` is Android-only (it names the chooser) and is ignored on iOS.
      // The text itself already opens with the note's first line, so nothing
      // is lost where it does not apply.
      await RNShare.share({ message: body }, { dialogTitle: 'Share note' });
    } catch {
      // See above.
    }
  }

  // Mobile edge-swipe-back, mirroring iOS's native interactive-pop gesture --
  // there's no real navigation stack here to provide that for free (list and
  // editor are conditionally-rendered panes in one screen, not routes).
  // Claimed only once an actual rightward drag starting near the left edge
  // is confirmed (onMoveShouldSetPanResponderCapture), not on touch-start --
  // otherwise every edge tap would be captured before it could reach
  // anything underneath, including this pane's own back button.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        const startX = evt.nativeEvent.pageX - gestureState.dx;
        return startX < 32 && gestureState.dx > 12 && Math.abs(gestureState.dy) < 24;
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx > 80) {
          onBackToList();
        }
      },
    })
  ).current;

  return (
    <VStack
      className={`
        flex-1 bg-background
        ${!selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
      `}
    >
      {selectedNote ? (
        <>
          {/* Top Navigation Row */}
          <HStack
            className="justify-between items-center px-4 py-3 border-b border-border"
            style={{ paddingTop: insets.top + 12 }}
          >
            <HStack className="items-center space-x-1">
              {/* Mobile Back Button */}
              <Pressable
                onPress={onBackToList}
                className="md:hidden flex-row items-center"
              >
                <Icon as={ChevronLeft} className="text-muted-foreground w-6 h-6" />
              </Pressable>

              {/* Desktop Sidebar Tuck/Untuck Toggle */}
              <Pressable
                onPress={onToggleSidebar}
                className="hidden md:flex p-1.5 rounded-md hover:bg-muted"
              >
                <Icon as={Menu} className="text-muted-foreground w-5 h-5" />
              </Pressable>
            </HStack>

            {/* Header Actions */}
            <HStack className="items-center space-x-3">
              {/* Share Action */}
              <Pressable
                onPress={handleShare}
                className="p-1.5 rounded-full hover:bg-muted"
                accessibilityRole="button"
                accessibilityLabel="Share this note"
              >
                <Icon as={Share} className="text-muted-foreground w-5 h-5" />
              </Pressable>

              {/* More Options (...) Menu */}
              <UIComponentsMenu
                placement="bottom right"
                offset={8}
                // Shaped like a settings group rather than a generic dropdown:
                // one rounded card, rows running its full width, hairlines
                // between them and nothing after the last. `p-0` matters --
                // the default padding insets the rows so their press
                // highlight stops short of the card edge, which is the tell of
                // a menu that is not native. See components/ui/settings-group.
                className="rounded-2xl p-0 overflow-hidden min-w-[220px]"
                // Disabling lives on the Menu, not the item: this is a
                // react-aria collection, so `disabledKeys` is what actually
                // makes a row non-interactive, and the item style already
                // carries data-[disabled=true]:opacity-40 to match.
                disabledKeys={apiGateOpen ? [] : ['api-visibility']}
                trigger={({ ...triggerProps }) => (
                  <Pressable
                    {...triggerProps}
                    className="p-1.5 rounded-full hover:bg-muted mr-2"
                  >
                    <Icon as={MoreVertical} className="text-muted-foreground w-5 h-5" />
                  </Pressable>
                )}
              >
                {/* The label states what the note IS, not what tapping will
                    do, and flips with the note: "Visible to Apps" when it is,
                    "Invisible to Apps" when it is not. The Eye/EyeOff icon
                    already worked that way, so a fixed label was the odd one
                    out -- it left the icon as the only thing carrying the
                    state, on a row people read rather than decode.

                    It deliberately does NOT flip on the gate being shut. That
                    is a different fact -- "nothing can read any note right
                    now" -- and it already has its own treatment: the row is
                    greyed and inert. Restating it in the label would reflow
                    the menu on a change that is not about this note.

                    Kept above Delete because it is the reversible one. */}
                <MenuItem
                  key="api-visibility"
                  textValue={visibilityLabel}
                  onPress={() => {
                    if (!apiGateOpen) return;
                    onSetHiddenFromApi(selectedNote.id, !selectedNote.isHiddenFromApi);
                  }}
                  className="px-4 py-3 flex-row items-center gap-3"
                >
                  <Icon
                    as={selectedNote.isHiddenFromApi ? EyeOff : Eye}
                    className={`w-[18px] h-[18px] ${
                      apiGateOpen ? 'text-muted-foreground' : 'text-muted-foreground/50'
                    }`}
                  />
                  <MenuItemLabel
                    className={`text-base ${
                      apiGateOpen ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {visibilityLabel}
                  </MenuItemLabel>
                </MenuItem>

                <MenuSeparator />

                <MenuItem
                  key="trash"
                  textValue="Delete"
                  onPress={() => onTrashNote(selectedNote.id)}
                  className="px-4 py-3 flex-row items-center gap-3"
                >
                  <Icon as={Trash2} className="text-destructive w-[18px] h-[18px]" />
                  <MenuItemLabel className="text-base text-destructive">
                    Delete
                  </MenuItemLabel>
                </MenuItem>
              </UIComponentsMenu>

              {/* Desktop Avatar */}
              <AvatarMenuTrigger className="hidden md:flex" />
            </HStack>
          </HStack>

          {/* Editor Detail Pane */}
          <Box
            className="flex-1"
            style={{ paddingBottom: editorBottomInset }}
            {...panResponder.panHandlers}
          >
            <RichEditor
              key={selectedNote.id}
              initialContent={selectedNote.body}
              onChange={onNoteChange}
              autoFocus={!selectedNote.body || selectedNote.body === ''}
              initialScrollOffset={initialEditorScrollOffset}
              onScrollOffsetChange={onEditorScrollOffsetChange}
            />
          </Box>
        </>
      ) : (
        <VStack
          className="flex-1 items-center justify-center p-4 bg-secondary"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <RNText className="text-muted-foreground text-base font-medium">
            Select a note or create a new one.
          </RNText>
        </VStack>
      )}
    </VStack>
  );
}
