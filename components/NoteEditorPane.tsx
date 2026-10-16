import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { PAD_BAR_HEIGHT, PadTopBar } from './PadTopBar';
import type { PaneChrome } from '@/lib/layout/paneChrome';
import { editorChrome } from '@/lib/layout/editorChrome';
import { findMatches, replaceInHtml, stepMatch } from '@/lib/notes/findMatches';
import { haptics } from '@/lib/theme/haptics';
import { FindBar } from './FindBar';
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
import {
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  FolderInput,
  Menu,
  Search,
  MoreVertical,
  Share,
  Trash2,
  Undo2,
} from 'lucide-react-native';

// Custom Types
import { Note, noteToPlainText, parseNoteContent } from '@/types/note';
import type { Folder } from '@/types/folder';
import { FolderPickerSheet } from './FolderPickerSheet';
import AvatarMenuTrigger from './AvatarMenuTrigger';
import { useApiGateOpen } from '@/lib/plaintext/useApiGate';
import { useAccountScreenShowing } from './AccountSuspendedOverlay';

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
  /** For the overflow menu's Move Note. Stage 11's picker, not a second one. */
  folders: Folder[];
  onMoveNote: (id: string, folderId: string | null) => void;
  onCreateFolder: (parentId: string | null, name: string) => void | Promise<void>;
  /** Which pane controls the editor owns right now. From `paneChrome()`. */
  chrome: PaneChrome;
  /** Brings back the pane immediately to the editor's left. */
  onRestorePanes: () => void;
  onNewNote: () => void;
  /** iPad only: hide both panes, or bring them back. */
  onToggleMaximised?: () => void;
  /** iPad only: reveal the note list and put the caret in its search field. */
  onFocusSearch?: () => void;
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
  folders,
  onMoveNote,
  onCreateFolder,
  chrome,
  onRestorePanes,
  onNewNote,
  onToggleMaximised,
  onFocusSearch,
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
  /**
   * WHICH CHROME, decided in one place: lib/layout/editorChrome.ts.
   *
   * It is a module with tests rather than three ternaries here because of Split
   * View. `Platform.isPad` stays true in a Split View pane, so "iPad gets the
   * iPad bar" would hand a 507pt-wide pane a bar laid out for a full screen.
   * Width has to win, and the test says so -- which is how that requirement
   * gets checked at all, given that driving Split View from a script means a
   * drag out of the Dock on a multitasking model iPadOS 26 rebuilt.
   *
   * `useWindowDimensions` reports the WINDOW, not the screen, so this responds
   * to a Split View resize on its own.
   */
  const chromeKind = editorChrome({
    width: useWindowDimensions().width,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
    isPad: Platform.OS === 'ios' && Platform.isPad,
  });

  const useCompact = chromeKind === 'phone';
  const isDesktop = Platform.OS === 'web';
  const useDesktopBar = chromeKind === 'desktop';
  const usePadBar = chromeKind === 'pad';

  const [textStyleOpen, setTextStyleOpen] = useState(false);
  const [movingNote, setMovingNote] = useState(false);

  /**
   * FIND AND REPLACE, owned here rather than in RichEditor.
   *
   * The bar is chrome — it sits with the top bar on desktop and takes the
   * formatting bar's slot on a phone — so it belongs to whatever owns the
   * chrome. The editor only lends it two capabilities through the handle:
   * select a range, and swap the document.
   */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [plainText, setPlainText] = useState('');
  const [currentMatch, setCurrentMatch] = useState(-1);

  const matches = useMemo(() => findMatches(plainText, findQuery), [plainText, findQuery]);

  /**
   * REVEALING A MATCH IS DELIBERATE, NOT AUTOMATIC — and that is the whole
   * design of this, found on the phone.
   *
   * Selecting a range requires focusing the editor: an unfocused UITextView
   * does not draw a selection, so a match highlighted without focus is a match
   * nobody can see. But focusing the editor takes focus OFF the Find field, so
   * a version that revealed on every keystroke moved the keyboard to the note
   * after the first letter and the user could not finish typing their query.
   *
   * So typing updates the COUNT only — "1 of 3" appears as you type — and the
   * match is revealed when you ask for one: next, previous, or the return key.
   * That is also how iOS's own find bar behaves, and it means the two focus
   * states never fight.
   *
   * A counter rather than a boolean, for the reason the iPad's search circle
   * uses one: "reveal it" is an event, and pressing next twice on the same
   * match must reveal it twice.
   */
  const [revealSignal, setRevealSignal] = useState(0);

  useEffect(() => {
    if (revealSignal === 0 || !findOpen) return;
    const match = matches[currentMatch];
    if (!match) return;
    editorRef.current?.selectRange(match.start, match.end);
  }, [revealSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A new query clears the current match rather than pointing at the first one.
   *
   * The two have to agree: nothing has been REVEALED yet, so claiming "1 of 4"
   * would say match one is highlighted when the note is untouched — and then
   * pressing next would jump to match two, skipping a match the user was told
   * they were on. With no current match the bar reads "4 matches" and next goes
   * to the first, which is what actually happens.
   */
  useEffect(() => {
    setCurrentMatch(-1);
  }, [findQuery, matches.length]);

  const step = useCallback(
    (direction: 1 | -1) => {
      setCurrentMatch((c) => stepMatch(c, matches.length, direction));
      setRevealSignal((n) => n + 1);
      // Moving through a set, which is what `selection` is for -- the same
      // feel a picker gives as it passes each row.
      haptics.step();
    },
    [matches.length]
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setReplaceOpen(false);
    setFindQuery('');
    setCurrentMatch(-1);
  }, []);

  const runReplace = useCallback(
    async (scope: number | 'all') => {
      const editor = editorRef.current;
      if (!editor || matches.length === 0) return;
      const html = await editor.getHtml();
      const result = replaceInHtml(html, findQuery, replacement, scope);
      if (result.count === 0) return;
      editor.setHtml(result.html);
      onNoteChange(result.html);
      // A commit, not a tap: replacing rewrites the note and pressing the
      // button again will not undo it.
      haptics.commit();
      // The document just changed, so every offset after the edit moved. The
      // match list recomputes from the new plain text on its own; resetting the
      // index is what stops "4 of 7" pointing into a note that now has 6.
      setCurrentMatch(-1);
    },
    [findQuery, matches.length, onNoteChange, replacement]
  );

  /**
   * ⌘F / Ctrl+F on the web, and Escape to leave.
   *
   * Not a nicety on desktop: a find bar reachable only from an overflow menu is
   * one nobody finds, and the browser's own ⌘F would otherwise search the
   * rendered page — which on a virtualised note list means it searches whatever
   * happens to be mounted. `preventDefault` is the point of intercepting it.
   *
   * Web only. There is no hardware keyboard to speak of on a phone, and iPadOS
   * routes hardware shortcuts through a different API that belongs with the
   * rest of the iPad keyboard work rather than bolted on here.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || !selectedNoteId) return;

    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (event.key === 'Escape') closeFind();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeFind, selectedNoteId]);


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

  /**
   * An account screen (scheduled for deletion / account deleted) covers the
   * whole app, and the editor underneath must not hold the keyboard. Two cases:
   * it never asks for focus while one is up (autoFocus below), and it lets go
   * when one APPEARS -- which on a cold start is after the editor has mounted,
   * because the "deleted" flag is read back from storage asynchronously.
   */
  const accountScreenShowing = useAccountScreenShowing();
  useEffect(() => {
    if (!accountScreenShowing) return;
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, [accountScreenShowing]);

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

      {/*
        MOVE NOTE, wired to Stage 11's folder picker rather than a second one.
        The list pane raises exactly this sheet from its own context menu, so a
        note filed from the editor and a note filed from the list go through the
        same screen, the same folder ordering and the same inline "New Folder" --
        which is the reason to reuse it, not that it saves work.

        Desktop is excluded for the same reason NoteListPane excludes it: there
        the picker is a flyout anchored to the click, and this menu has no anchor
        to give it. Desktop files notes from the list, where that anchor exists.
      */}
      <MenuItem
        key="find"
        textValue="Find in Note"
        onPress={() => {
          setFindOpen(true);
          setReplaceOpen(false);
        }}
        className="px-4 py-3 flex-row items-center gap-3"
      >
        <Icon as={Search} className="text-muted-foreground w-4.5 h-4.5" />
        <MenuItemLabel className="text-base text-foreground">Find in Note</MenuItemLabel>
      </MenuItem>

      {!isDesktop ? (
        <MenuItem
          key="move"
          textValue="Move Note"
          onPress={() => setMovingNote(true)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={FolderInput} className="text-muted-foreground w-4.5 h-4.5" />
          <MenuItemLabel className="text-base text-foreground">Move Note</MenuItemLabel>
        </MenuItem>
      ) : null}

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
          {usePadBar ? (
            /*
              iPAD: the same floating idea as desktop, a different arrangement.
              `ipad-collapsed-groups.jpeg` is the reference and it wins over the
              plan's prose, which said iPad would inherit desktop's three zones.
            */
            <PadTopBar
              chrome={chrome}
              onToggleMaximised={() => onToggleMaximised?.()}
              onNewNote={onNewNote}
              onShare={handleShare}
              onSearch={() => onFocusSearch?.()}
              canFormat={EDITOR_SUPPORTS_FORMATTING}
              onTextStyles={() => setTextStyleOpen((v) => !v)}
              menuTrigger={renderOverflowMenu(selectedNote)}
              topInset={insets.top}
            />
          ) : useDesktopBar ? (
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
              topInset={insets.top}
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
              autoFocus={!accountScreenShowing && (!selectedNote.body || selectedNote.body === '')}
              initialScrollOffset={initialEditorScrollOffset}
              onScrollOffsetChange={onEditorScrollOffsetChange}
              onPlainTextChange={setPlainText}
              // The formatting bar and the find bar want the same slot above
              // the keyboard. Find wins while it is open -- you are searching,
              // not formatting, and they are never both wanted at once. This is
              // the three-way contention the stage plan asked to be decided
              // rather than discovered.
              suppressFormatBar={findOpen}
              // Clears whichever bar is floating. A wide iPad still has a real
              // bordered row above the document and needs nothing.
              contentInsetTop={
                useCompact
                  ? navBarHeight
                  : useDesktopBar
                    ? BAR_HEIGHT + insets.top
                    : usePadBar
                      ? PAD_BAR_HEIGHT + insets.top
                      : 0
              }
              textStyleOpen={textStyleOpen}
              onCloseTextStyle={() => setTextStyleOpen(false)}
              // Hangs from the underside of the bar, not from the window edge.
              textStyleTop={(usePadBar ? PAD_BAR_HEIGHT : BAR_HEIGHT) + insets.top - 8}
              // The two panels are different shapes -- a vertical list under a
              // pointer, a grid under a thumb -- so the editor is told which to
              // render rather than guessing from its own width.
              stylePanel={usePadBar ? 'pad' : 'desktop'}
            />
          </Box>

          <FindBar
            visible={findOpen}
            query={findQuery}
            onQueryChange={setFindQuery}
            replacement={replacement}
            onReplacementChange={setReplacement}
            replaceOpen={replaceOpen}
            onToggleReplace={() => setReplaceOpen((v) => !v)}
            matchCount={matches.length}
            currentMatch={currentMatch}
            onStep={step}
            onSubmit={() => setRevealSignal((n) => n + 1)}
            onReplaceOne={() => void runReplace(currentMatch < 0 ? 0 : currentMatch)}
            onReplaceAll={() => void runReplace('all')}
            onClose={closeFind}
            // Docked on a phone, a strip under the top bar everywhere else --
            // the same split the two reference screenshots draw.
            layout={useCompact ? 'docked' : 'inline'}
            top={(usePadBar ? PAD_BAR_HEIGHT : BAR_HEIGHT) + insets.top}
          />

          {movingNote ? (
            <FolderPickerSheet
              isOpen
              label={parseNoteContent(selectedNote.body).title}
              noteCount={1}
              folders={folders}
              currentFolderId={selectedNote.folderId}
              onClose={() => setMovingNote(false)}
              onSelect={(folderId) => {
                onMoveNote(selectedNote.id, folderId);
                setMovingNote(false);
              }}
              onCreateFolder={onCreateFolder}
            />
          ) : null}
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
