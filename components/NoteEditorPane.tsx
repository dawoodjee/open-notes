import React, { useRef } from 'react';
import { Text as RNText, PanResponder, Keyboard, Platform } from 'react-native';
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
import { Note } from '@/types/note';
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
              <Pressable className="p-1.5 rounded-full hover:bg-muted">
                <Icon as={Share} className="text-muted-foreground w-5 h-5" />
              </Pressable>

              {/* More Options (...) Menu */}
              <UIComponentsMenu
                placement="bottom right"
                offset={8}
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
                {/* Visible to Apps -- only meaningful while the API gate is
                    open, so it is inert when it is not. The label stays short
                    in both states: the greyed, unresponsive row already says
                    "not available", and a row that grows an explanatory clause
                    only when disabled reflows the menu and reads as an error.
                    Kept above Delete because it is the reversible one. */}
                <MenuItem
                  key="api-visibility"
                  textValue="Visible to Apps"
                  onPress={() => {
                    if (!apiGateOpen) return;
                    onSetHiddenFromApi(selectedNote.id, !selectedNote.isHiddenFromApi);
                  }}
                  className="p-2.5 flex-row items-center gap-2"
                >
                  <Icon
                    as={selectedNote.isHiddenFromApi ? EyeOff : Eye}
                    className={`w-4 h-4 ${apiGateOpen ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}
                  />
                  <MenuItemLabel
                    className={`text-sm font-medium ${
                      apiGateOpen ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    Visible to Apps
                  </MenuItemLabel>
                </MenuItem>

                <MenuItem
                  key="trash"
                  textValue="Delete"
                  onPress={() => onTrashNote(selectedNote.id)}
                  className="p-2.5 flex-row items-center gap-2"
                >
                  <Icon as={Trash2} className="text-destructive w-4 h-4" />
                  <MenuItemLabel className="text-sm font-medium text-destructive">
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
