import React, { useReducer, useState, useRef, useEffect, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import NoteListPane from './NoteListPane';
import NoteEditorPane from './NoteEditorPane';
import DesktopResizeHandle from './DesktopResizeHandle';

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';

// Custom Store & Types
import { initialNotesState, notesReducer } from '@/types/notesStore';
import {
  powersync,
  initPowerSync,
  mapRowToNote,
  createNoteInDB,
  updateNoteInDB,
  trashNoteInDB,
} from '@/lib/powersync/db';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function NotesLayout() {
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

  // PowerSync local SQLite init + live watch query.
  // The watch callback is the *only* place notes state gets set — the reducer
  // just mirrors whatever SQLite currently reports, it doesn't own the data.
  useEffect(() => {
    const abortController = new AbortController();

    async function setupDatabase() {
      try {
        await initPowerSync();

        powersync.watch(
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

  const handleTrashNote = useCallback(async (id: string) => {
    try {
      await trashNoteInDB(id);
      dispatch({ type: 'SELECT_NOTE', payload: { id: null } });
    } catch (err) {
      console.error('Failed to trash note in local SQLite:', err);
    }
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
          onNoteChange={handleNoteChange}
        />
      </HStack>
    </SafeAreaView>
  );
}
