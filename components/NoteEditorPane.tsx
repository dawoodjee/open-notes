import React, { useEffect, useRef, useState } from 'react';
import {
  Text as RNText,
  PanResponder,
  Platform,
  Keyboard,
  // The API, not the lucide glyph of the same name imported below. Built into
  // React Native, so sharing needs no new dependency.
  Share as RNShare,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardShown } from '@/hooks/useKeyboardShown';
import RichEditor, {
  EDITOR_SUPPORTS_FORMATTING,
  type RichEditorHandle,
} from './RichEditor';
import { ChromeScrim } from './ChromeScrim';
import { BAR_HEIGHT, DesktopTopBar } from './DesktopTopBar';
import type { PaneChrome } from '@/lib/layout/paneChrome';
import { GROUP_GAP, IconButton, IconButtonGroup, SURFACE } from './IconButton';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Icon } from '@/components/ui/icon';
import { Box } from '@/components/ui/box';

import {
  Menu as UIComponentsMenu,
  MenuItem,
  MenuItemLabel,
  MenuSeparator,
} from '@/components/ui/menu';

// Lucide Icons
import { Check, ChevronLeft, Eye, EyeOff, Menu, MoreVertical, Share, Trash2, Undo2 } from 'lucide-react-native';

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
  /** Which pane controls the editor owns right now. From `paneChrome()`. */
  chrome: PaneChrome;
  /** Brings back the pane immediately to the editor's left. */
  onRestorePanes: () => void;
  onNewNote: () => void;
  searchQuery: string;
  onSearchChange: (next: string) => void;
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
  chrome,
  onRestorePanes,
  onNewNote,
  searchQuery,
  onSearchChange,
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

  /**
   * The phone bar floats, so the document has to be told how much to leave
   * clear. Derived from the same numbers the bar is laid out with rather than
   * a second literal, so the two cannot drift.
   */
  const useCompact = useWindowDimensions().width < 768;

  /**
   * The floating desktop bar replaces the bordered header row, and ONLY on web.
   *
   * Not because iPad is narrower -- it is not -- but because iPad gets its own
   * collapsible-first arrangement in 12e, and shipping the desktop bar there
   * first would mean building a layout twice and throwing one away. Until then
   * a wide iPad keeps the bordered row it already has.
   */
  const useDesktopBar = Platform.OS === 'web' && !useCompact;
  const [textStyleOpen, setTextStyleOpen] = useState(false);

  // Closing when the note changes is not tidiness: the panel reports the
  // caret's styles, and the caret moved to a different document.
  useEffect(() => setTextStyleOpen(false), [selectedNoteId]);
  const navBarHeight = insets.top + 8 + SURFACE + 12;
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
  const editorRef = useRef<RichEditorHandle>(null);

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

  /**
   * The overflow menu, built once and rendered in whichever chrome is on
   * screen. The phone bar puts it in a capsule with Share; the desktop bar
   * takes it as `menuTrigger` and puts it in that bar's own right-hand group.
   *
   * Extracted rather than duplicated because it is the one control whose
   * CONTENTS are non-trivial -- the API-visibility row's enabled state, its
   * state-not-action label, and Delete. Two copies of that would drift, and
   * the copy that drifted would be the one nobody was looking at.
   */
  const renderOverflowMenu = (note: Note) => (
    <UIComponentsMenu
      placement="bottom right"
      offset={8}
      // Shaped like a settings group rather than a generic dropdown:
      // one rounded card, rows running its full width, hairlines
      // between them and nothing after the last. `p-0` matters --
      // the default padding insets the rows so their press
      // highlight stops short of the card edge, which is the tell of
      // a menu that is not native. See components/ui/settings-group.
      className="rounded-2xl p-0 overflow-hidden min-w-55"
      // Disabling lives on the Menu, not the item: this is a
      // react-aria collection, so `disabledKeys` is what actually
      // makes a row non-interactive, and the item style already
      // carries data-[disabled=true]:opacity-40 to match.
      disabledKeys={apiGateOpen ? [] : ['api-visibility']}
      trigger={({ ...triggerProps }) => (
        // IconButton forwards the ref the Menu needs to position
        // its popover.
        <IconButton {...triggerProps} icon={MoreVertical} label="More options" />
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
          onSetHiddenFromApi(note.id, !note.isHiddenFromApi);
        }}
        className="px-4 py-3 flex-row items-center gap-3"
      >
        <Icon
          as={note.isHiddenFromApi ? EyeOff : Eye}
          className={`w-4.5 h-4.5 ${
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
        onPress={() => onTrashNote(note.id)}
        className="px-4 py-3 flex-row items-center gap-3"
      >
        <Icon as={Trash2} className="text-destructive w-4.5 h-4.5" />
        <MenuItemLabel className="text-base text-destructive">
          Delete
        </MenuItemLabel>
      </MenuItem>
    </UIComponentsMenu>
  );

  return (
    <VStack
      className={`
        flex-1 bg-background
        ${!selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
      `}
    >
      {selectedNote ? (
        <>
          {useDesktopBar ? (
            /*
              DESKTOP: the bar FLOATS over the note instead of sitting above it.

              This is the wiring Stage 12c built the bar for and could not
              finish -- web had no database, so a bar over a real document was
              unverifiable, and writing it blind is the "reads correct, does
              nothing" pattern that produced the dead force-swipe. 12g gave web
              real notes, so it lands now.

              The pane's controls are decided by `paneChrome()` upstream and
              arrive as `chrome`; this component only hands them over.
            */
            <DesktopTopBar
              chrome={chrome}
              onRestorePanes={onRestorePanes}
              onNewNote={onNewNote}
              onShare={handleShare}
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              menuTrigger={renderOverflowMenu(selectedNote)}
              canFormat={EDITOR_SUPPORTS_FORMATTING}
              onTextStyles={() => setTextStyleOpen((v) => !v)}
              onChecklist={() => editorRef.current?.run('checklist')}
            />
          ) : (
            <>
            {/*
              FLOATS on a phone, sits in a row on wide layouts.

              `mobile-navbar-default-aa-undo-redo.png` draws the phone bar over
              the note's own text, not in a strip above it, and Adam's call was
              that the screenshot wins over the prose here. So on a phone this is
              absolutely positioned with a scrim behind it and the document is
              inset to clear it; wide layouts keep the bordered row until 12e
              gives the iPad its own chrome.
            */}
            {useCompact ? <ChromeScrim height={navBarHeight} /> : null}
            <HStack
              className={
                useCompact
                  ? 'justify-between items-center px-4 pb-3'
                  : 'justify-between items-center px-4 py-3 border-b border-border'
              }
              style={
                useCompact
                  ? {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      zIndex: 10,
                      paddingTop: insets.top + 8,
                    }
                  : { paddingTop: insets.top + 12 }
              }
            >
              <HStack className="items-center" style={{ gap: GROUP_GAP }}>
                {/* Mobile Back Button */}
                <View className="md:hidden">
                  <IconButton icon={ChevronLeft} label="Back to list" onPress={onBackToList} />
                </View>

                {/*
                  UNDO, and it does not work.

                  The reference gives Undo its own circle beside Back, and the
                  spec asks for a contextual Redo. `react-native-enriched-html`
                  exposes NO undo or redo API at all -- not on the instance, not
                  on the native side. So Undo renders dimmed under the standing
                  rule for controls the editor cannot perform, and Redo, being
                  specified as hidden until something has been undone, simply
                  never arms. That satisfies both rules at once and leaves no
                  permanently visible dead button.

                  Worth revisiting at the end of the iteration: this editor
                  already keeps a ledger of every document version it has
                  produced (see `echoesRef`), so an undo stack built on
                  `setValue` is plausible. The open question is the caret, which
                  `setValue` does not preserve.
                */}
                <View className="md:hidden">
                  <IconButton
                    icon={Undo2}
                    label="Undo"
                    disabled
                    disabledReason="Not available in this editor yet"
                  />
                </View>

                {/* Desktop Sidebar Tuck/Untuck Toggle */}
                <View className="hidden md:flex">
                  <IconButton icon={Menu} label="Toggle folder sidebar" onPress={onToggleSidebar} />
                </View>
              </HStack>

              {/* Header Actions.
                  ONE capsule, not two adjacent circles. Share and the overflow
                  are both "act on this note", which is what merges controls --
                  and `icon-buttons-editor-accent.png` draws exactly this pair as
                  a single capsule beside a lone round Back. Both were
                  `hover:bg-muted` with NO press state before, so on a phone or an
                  iPad they had no visual feedback whatsoever. */}
              <HStack className="items-center" style={{ gap: GROUP_GAP }}>
              <IconButtonGroup>
                <IconButton icon={Share} label="Share this note" onPress={handleShare} />

                {/* More Options (...) Menu */}
                {renderOverflowMenu(selectedNote)}
              </IconButtonGroup>

              {/* Desktop Avatar -- OUTSIDE the capsule. It is identity, not an
                  action on this note, so it does not belong in a group whose
                  meaning is "act on this note". */}
              <AvatarMenuTrigger className="hidden md:flex" />

              {/*
                DONE -- the accent circle the reference puts at the right end.
                Only while the keyboard is up, because that is the only time
                there is anything to be done WITH: it dismisses the keyboard.
                Rendering it permanently would be a button that mostly does
                nothing, which is the dead-button case the spec rules out for
                Redo and applies just as well here.
              */}
              {useCompact && keyboardShown ? (
                <IconButton
                  icon={Check}
                  label="Done editing"
                  variant="accent"
                  onPress={() => {
                    // The editor's OWN blur, not Keyboard.dismiss(). The native
                    // editor is a UITextView behind a Fabric component and never
                    // sees RN's dismiss, so this button did nothing on iOS until
                    // 2026-08-22. Keyboard.dismiss() stays as a second call for
                    // anything else on screen that does answer to it -- a search
                    // field, a rename input -- and is harmless when nothing does.
                    editorRef.current?.blur();
                    Keyboard.dismiss();
                  }}
                />
              ) : null}
            </HStack>
            </HStack>
            </>
          )}

          {/* Editor Detail Pane */}
          <Box
            className="flex-1"
            style={{ paddingBottom: editorBottomInset }}
            {...panResponder.panHandlers}
          >
            <RichEditor
              ref={editorRef}
              key={selectedNote.id}
              initialContent={selectedNote.body}
              onChange={onNoteChange}
              autoFocus={!selectedNote.body || selectedNote.body === ''}
              initialScrollOffset={initialEditorScrollOffset}
              onScrollOffsetChange={onEditorScrollOffsetChange}
              // Clears whichever bar is floating. A wide iPad still has a real
              // bordered row above the document and needs nothing.
              contentInsetTop={useCompact ? navBarHeight : useDesktopBar ? BAR_HEIGHT : 0}
              textStyleOpen={textStyleOpen}
              onCloseTextStyle={() => setTextStyleOpen(false)}
              // Hangs from the underside of the bar, not from the window edge.
              textStyleTop={BAR_HEIGHT - 8}
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
