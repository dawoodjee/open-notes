import React, { useReducer, useState, useRef, useEffect, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform, BackHandler } from 'react-native';
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
  setNoteHiddenFromApi,
  updateNoteInDB,
  trashNoteInDB,
  getUiState,
  saveUiState,
} from '@/lib/powersync/db';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function NotesLayout() {
  const { session } = useAuth();
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
              dispatch({ type: 'SET_NOTES', payload: { notes: result.array.map(mapRowToNote) } });
            },
            onError: (err) => {
              console.error('PowerSync watch error:', err);
            },
          },
          { signal: abortController.signal }
        );
      } catch (err) {
        console.error('Failed to initialize PowerSync local database:', err);
      }
    }

    setupDatabase();

    return () => {
      abortController.abort();
    };
  }, []);

  // Timer ref to hold pending SQLite writes
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced SQLite write to avoid disk thrashing on every keystroke
  const handleNoteChange = useCallback(
    (html: string) => {
      if (!selectedNote) return;

      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      updateTimeoutRef.current = setTimeout(async () => {
        try {
          await updateNoteInDB(selectedNote.id, html);
        } catch (err) {
          console.error('Failed to update note in local SQLite:', err);
        }
      }, 300);
    },
    [selectedNote]
  );

  const handleCreateNote = useCallback(async () => {
    try {
      const newNote = await createNoteInDB();
      dispatch({ type: 'SELECT_NOTE', payload: { id: newNote.id } });
    } catch (err) {
      console.error('Failed to create note in local SQLite:', err);
    }
  }, []);

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
        dispatch({ type: 'SELECT_NOTE', payload: { id: null } });
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [selectedNoteId]);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <HStack
        className="flex-1 w-full bg-white select-none"
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
          onSelectNote={(id) => dispatch({ type: 'SELECT_NOTE', payload: { id } })}
          onCreateNote={handleCreateNote}
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
          onBackToList={() => dispatch({ type: 'SELECT_NOTE', payload: { id: null } })}
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
