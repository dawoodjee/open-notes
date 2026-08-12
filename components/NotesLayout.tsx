import React, { useReducer, useState, useRef, useEffect, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform, AppState, BackHandler } from 'react-native';
import NoteListPane from './NoteListPane';
import NoteEditorPane from './NoteEditorPane';
import DesktopResizeHandle from './DesktopResizeHandle';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';

// Custom Store & Types
import { initialNotesState, notesReducer } from '@/types/notesStore';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPowerSync,
  initPowerSync,
  mapRowToNote,
  createNoteInDB,
  permanentDeleteNoteInDB,
  setNoteHiddenFromApi,
  updateNoteInDB,
  trashNoteInDB,
  getUiState,
  saveUiState,
} from '@/lib/powersync/db';
import { isBlankNote } from '@/types/note';
import { BootSpinner } from '@/components/BootSpinner';
import { BACKGROUND, useTheme } from '@/contexts/ThemeContext';

// How long the launch gate below will wait before giving up and painting
// whatever it has. Deliberately generous -- it is a failsafe for a path that
// should never be taken, not a budget for the normal one, which finishes in a
// couple of local SQLite reads.
const LAUNCH_GATE_TIMEOUT_MS = 3000;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function NotesLayout() {
  const { session } = useAuth();
  const { scheme } = useTheme();
  const [state, dispatch] = useReducer(notesReducer, initialNotesState);
  const { notes, selectedNoteId, searchQuery } = state;

  const [isSidebarTucked, setIsSidebarTucked] = useState<boolean>(false);

  // Desktop Resizable Panel Logic
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const isResizing = useRef<boolean>(false);

  const startResizing = () => {
    isResizing.current = true;
  };

  const stopResizing = () => {
    isResizing.current = false;
  };

  const resize = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isResizing.current) return;
    const newWidth = e.clientX;
    if (newWidth >= 200 && newWidth <= 480) {
      setSidebarWidth(newWidth);
    }
  };

  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  // Restored editor scroll offset, read once at startup. Held in a ref (not
  // state) so later scrolling doesn't re-render or re-trigger the restore.
  const restoredEditorScrollRef = useRef<number>(0);

  // Whether the empty-database fallback has already fired this launch.
  const hasAutoCreatedRef = useRef<boolean>(false);

  /**
   * False until this launch has decided what to show, which is not the same as
   * "the database has answered".
   *
   * Restoring the last-opened note takes two awaits (read ui_state, then check
   * the note still exists) and the watch query only starts after them, so the
   * panes used to paint twice before landing: once as an empty list reading
   * "0 Notes", and once as "Select a note or create a new one." -- the window
   * where selectedNoteId is set but no note has arrived to match it. Both are
   * artefacts of that ordering, not states the user has any use for.
   *
   * Local state rather than reducer state on purpose: the reducer's contract
   * is to mirror whatever SQLite reports (see types/notesStore.ts), and this is
   * a question about the launch, not about the notes.
   */
  const [launchSettled, setLaunchSettled] = useState(false);

  const handleCreateNote = useCallback(async () => {
    try {
      const newNote = await createNoteInDB();
      dispatch({ type: 'SELECT_NOTE', payload: { id: newNote.id } });
      return newNote;
    } catch (err) {
      console.error('Failed to create note in local SQLite:', err);
      return null;
    }
  }, []);

  // Read by the watch callback, which is registered once and would otherwise
  // capture the very first handleCreateNote forever.
  const createNoteRef = useRef(handleCreateNote);
  createNoteRef.current = handleCreateNote;

  // PowerSync local SQLite init + live watch query.
  // The watch callback is the *only* place notes state gets set — the reducer
  // just mirrors whatever SQLite currently reports, it doesn't own the data.
  useEffect(() => {
    const abortController = new AbortController();

    async function setupDatabase() {
      try {
        await initPowerSync();

        // Restore last session's open note before notes arrive -- but only
        // after confirming it still exists. A logout (or any
        // disconnectAndClear) wipes the notes table, and ui_state can outlive
        // it; restoring a dangling id would open the editor pane on a note
        // that isn't there, which on mobile hides the list pane entirely and
        // leaves no way back to create the first note.
        const uiState = await getUiState();
        restoredEditorScrollRef.current = uiState.editorScrollOffset;
        if (uiState.lastOpenedNoteId) {
          const stillExists = await getPowerSync().getOptional<{ id: string }>(
            'SELECT id FROM notes WHERE id = ?',
            [uiState.lastOpenedNoteId]
          );
          if (stillExists) {
            dispatch({ type: 'SELECT_NOTE', payload: { id: uiState.lastOpenedNoteId } });
          }
        }

        getPowerSync().watch(
          'SELECT * FROM notes ORDER BY updated_at DESC',
          [],
          {
            onResult: (result) => {
              const notes = result.array.map(mapRowToNote);
              dispatch({ type: 'SET_NOTES', payload: { notes } });

              // Landing on an empty database means landing on a blank list
              // with nothing to read and nothing to do. Open a note instead,
              // the way Apple Notes does.
              //
              // Guarded by a ref that never resets, and that guard is not
              // optional: discardIfEmpty deletes the note you leave, so
              // without it every return to the list would delete this note,
              // observe an empty database, and create another one -- forever.
              // Firing once per launch means the user can genuinely get to an
              // empty list if they trash their last note by hand.
              const activeCount = notes.filter((n) => !n.isTrashed).length;

              if (activeCount === 0 && !hasAutoCreatedRef.current) {
                hasAutoCreatedRef.current = true;
                // Stay gated across the insert: the note this creates is what
                // the user is meant to land in, and it only reaches `notes` on
                // a later tick. Releasing here would paint the empty list for
                // exactly one INSERT round-trip. If the insert fails there is
                // nothing left to wait for, so release and show the list.
                void createNoteRef.current().then((created) => {
                  if (!created) setLaunchSettled(true);
                });
              } else {
                // Either a note is on screen, or the database is genuinely
                // empty and the one auto-create this launch gets has already
                // been spent -- nothing further is coming either way.
                setLaunchSettled(true);
              }
            },
            onError: (err) => {
              console.error('PowerSync watch error:', err);
              setLaunchSettled(true);
            },
          },
          { signal: abortController.signal }
        );
      } catch (err) {
        console.error('Failed to initialize PowerSync local database:', err);
        setLaunchSettled(true);
      }
    }

    setupDatabase();

    // Last resort. Everything above releases the gate on both its success and
    // its failure paths, but the gate sits in front of the entire app, so a
    // path nobody anticipated must not be able to leave the user staring at a
    // spinner forever. Better to show an empty list than nothing at all.
    const failsafe = setTimeout(() => setLaunchSettled(true), LAUNCH_GATE_TIMEOUT_MS);

    return () => {
      clearTimeout(failsafe);
      abortController.abort();
    };
  }, []);

  // Timer ref to hold pending SQLite writes, alongside the write it would
  // have performed. Keeping the payload lets a blur flush it immediately
  // instead of racing it -- see flushPendingWrite.
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWriteRef = useRef<{ id: string; html: string } | null>(null);

  /**
   * Commit whatever the debounce is still holding, right now.
   *
   * Load-bearing for discardIfEmpty below. Leaving a note fires the discard
   * check within milliseconds, while the last 300ms of typing may not have
   * reached SQLite yet -- so the note in the database would still look empty
   * when it isn't, and it would be deleted out from under the text just
   * typed. Flushing first removes the race rather than widening a timeout and
   * hoping.
   */
  const flushPendingWrite = useCallback(async () => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    const pending = pendingWriteRef.current;
    pendingWriteRef.current = null;
    if (!pending) return;

    try {
      await updateNoteInDB(pending.id, pending.html);
    } catch (err) {
      console.error('Failed to update note in local SQLite:', err);
    }
  }, []);

  // Debounced SQLite write to avoid disk thrashing on every keystroke
  const handleNoteChange = useCallback(
    (html: string) => {
      if (!selectedNote) return;

      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      pendingWriteRef.current = { id: selectedNote.id, html };

      updateTimeoutRef.current = setTimeout(() => {
        void flushPendingWrite();
      }, 300);
    },
    [selectedNote, flushPendingWrite]
  );

  /**
   * Delete the note being left behind, if there is nothing in it.
   *
   * Apple Notes' behaviour, with a deliberately narrow blast radius: this only
   * ever looks at the ONE note you are navigating away from. It is not a sweep
   * of every empty note in the database, so it cannot cascade.
   *
   * Four guards, each preventing a distinct way this could destroy real data:
   *
   *   decryptFailed  An unreadable note reads as empty. Deleting it would turn
   *                  a temporary key problem into permanent data loss -- the
   *                  same reasoning updateNoteInDB uses to refuse writes.
   *   isTrashed      Already handled by the trash flow; nothing to do.
   *   last note      Never leave the database empty. Otherwise this and the
   *                  auto-create below ping-pong forever: create, leave,
   *                  delete, create.
   *   re-read from   React state is a snapshot from the last watch tick. The
   *   the database   authority on whether the note is empty is SQLite, after
   *                  the flush above.
   *
   * NOTE this is the app's first and only caller of permanentDeleteNoteInDB,
   * which becomes an UpdateType.DELETE on the server. The dev log below exists
   * so that if a note ever disappears unexpectedly again, this path can be
   * ruled in or out immediately instead of by inference.
   */
  const discardIfEmpty = useCallback(
    async (noteId: string) => {
      await flushPendingWrite();

      try {
        const row = await getPowerSync().getOptional<any>(
          'SELECT * FROM notes WHERE id = ?',
          [noteId]
        );
        if (!row) return;

        const note = mapRowToNote(row);
        if (note.decryptFailed || note.isTrashed) return;
        if (!isBlankNote(note.body)) return;

        const remaining = await getPowerSync().get<{ count: number }>(
          'SELECT count(*) as count FROM notes WHERE is_trashed = 0 AND id != ?',
          [noteId]
        );
        if (remaining.count === 0) return;

        if (__DEV__) {
          console.warn(`[notes] discarding empty note ${noteId} on blur`);
        }
        await permanentDeleteNoteInDB(noteId);
      } catch (err) {
        console.error('Failed to discard empty note:', err);
      }
    },
    [flushPendingWrite]
  );

  /** Leave the current note, discarding it if it was never written in. */
  const leaveNote = useCallback(
    (nextId: string | null) => {
      const leaving = selectedNoteId;
      dispatch({ type: 'SELECT_NOTE', payload: { id: nextId } });
      if (leaving && leaving !== nextId) void discardIfEmpty(leaving);
    },
    [selectedNoteId, discardIfEmpty]
  );

  /**
   * The "+" button. Distinct from handleCreateNote because tapping it is also
   * a way of leaving the note you were in -- without this, "+" from an
   * untouched new note leaves that one behind and starts another.
   */
  const handleCreateNotePressed = useCallback(async () => {
    const leaving = selectedNoteId;
    const created = await handleCreateNote();
    if (leaving && created && leaving !== created.id) void discardIfEmpty(leaving);
  }, [selectedNoteId, handleCreateNote, discardIfEmpty]);

  const handleSetHiddenFromApi = useCallback(async (id: string, hidden: boolean) => {
    try {
      await setNoteHiddenFromApi(id, hidden);
    } catch (err) {
      console.error('Failed to change API visibility in local SQLite:', err);
    }
  }, []);

  const handleTrashNote = useCallback(async (id: string) => {
    try {
      await trashNoteInDB(id);
      dispatch({ type: 'SELECT_NOTE', payload: { id: null } });
    } catch (err) {
      console.error('Failed to trash note in local SQLite:', err);
    }
  }, []);

  // Persist which note is open so the next launch reopens it
  useEffect(() => {
    if (!selectedNoteId) return;
    saveUiState({ lastOpenedNoteId: selectedNoteId }).catch((err) =>
      console.error('Failed to persist last opened note:', err)
    );
  }, [selectedNoteId]);

  // Logging out wipes local notes, but selectedNoteId lives in React state
  // and survives that wipe -- leaving the editor pane open on a note that no
  // longer exists. On mobile that pane covers the list entirely, so there's
  // no list, no "+" button, and no way out: the same lockout the boot-time
  // ui_state check fixes, arriving by a different route (that check only
  // runs at startup, and this happens mid-session).
  //
  // Keyed to the auth transition rather than to "notes went empty" on
  // purpose. An empty result from the watch query is ambiguous -- it also
  // happens for a moment right after creating the first note, and clearing
  // the selection on that would flash the editor open then shut. Signing out
  // is unambiguous.
  const wasSignedInRef = useRef(false);
  useEffect(() => {
    if (session) {
      wasSignedInRef.current = true;
      return;
    }
    if (wasSignedInRef.current) {
      wasSignedInRef.current = false;
      dispatch({ type: 'SELECT_NOTE', payload: { id: null } });
    }
  }, [session]);

  // Android hardware back button: on mobile, with a note open, go back to
  // the list instead of the OS default (exiting the app) -- there's no real
  // navigation stack here (list/editor are conditionally-rendered panes in
  // one screen, not routes), so nothing handles this without an explicit
  // listener. Desktop/tablet shows both panes at once, so back has nothing
  // to "return to" there -- only intercept when a note is actually selected.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedNoteId) {
        leaveNote(null);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [selectedNoteId, leaveNote]);

  // Sending the app to the background is leaving the note too -- otherwise an
  // untouched new note survives simply because you switched apps instead of
  // tapping back, and comes back as clutter at the top of the list.
  //
  // Deliberately does NOT clear the selection: you should return to what you
  // had open. Only the discard runs, and only if the note is genuinely blank.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'background' && next !== 'inactive') return;
      if (selectedNoteId) void discardIfEmpty(selectedNoteId);
    });
    return () => subscription.remove();
  }, [selectedNoteId, discardIfEmpty]);

  const scrollSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEditorScrollChange = useCallback((offset: number) => {
    if (scrollSaveTimeoutRef.current) {
      clearTimeout(scrollSaveTimeoutRef.current);
    }

    scrollSaveTimeoutRef.current = setTimeout(() => {
      saveUiState({ editorScrollOffset: Math.round(offset) }).catch((err) =>
        console.error('Failed to persist editor scroll offset:', err)
      );
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollSaveTimeoutRef.current) {
        clearTimeout(scrollSaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [selectedNote?.id]);

  // Every hook is above this line, and must stay there: the watch query, the
  // ui_state writes and the AppState handlers all have to keep running while
  // the gate is up. It is the panes that wait, not the work.
  if (!launchSettled) return <BootSpinner />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND[scheme] }}>
      <HStack
        className="flex-1 w-full bg-background select-none"
        {...(Platform.OS === 'web'
          ? {
              onMouseMove: (e: any) => resize(e),
              onMouseUp: stopResizing,
            }
          : {})}
      >
        {/* ========================================================= */}
        {/* LEFT PANE: Note List Component                            */}
        {/* ========================================================= */}
        <NoteListPane
          notes={notes}
          selectedNoteId={selectedNoteId}
          searchQuery={searchQuery}
          isSidebarTucked={isSidebarTucked}
          sidebarWidth={sidebarWidth}
          onSelectNote={(id) => leaveNote(id)}
          onCreateNote={handleCreateNotePressed}
          onSearchChange={(query) =>
            dispatch({ type: 'SET_SEARCH_QUERY', payload: { query } })
          }
        />

        {/* ========================================================= */}
        {/* DESKTOP RESIZE HANDLE BAR                                 */}
        {/* ========================================================= */}
        <DesktopResizeHandle
          isSidebarTucked={isSidebarTucked}
          selectedNoteId={selectedNoteId}
          onStartResizing={startResizing}
        />

        {/* ========================================================= */}
        {/* RIGHT PANE: Editor Component                              */}
        {/* ========================================================= */}
        <NoteEditorPane
          selectedNote={selectedNote}
          selectedNoteId={selectedNoteId}
          isSidebarTucked={isSidebarTucked}
          onToggleSidebar={() => setIsSidebarTucked(!isSidebarTucked)}
          onBackToList={() => leaveNote(null)}
          onTrashNote={handleTrashNote}
          onSetHiddenFromApi={handleSetHiddenFromApi}
          onNoteChange={handleNoteChange}
          initialEditorScrollOffset={restoredEditorScrollRef.current}
          onEditorScrollOffsetChange={handleEditorScrollChange}
        />
      </HStack>
    </SafeAreaView>
  );
}
