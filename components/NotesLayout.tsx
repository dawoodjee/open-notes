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

  // Timer ref to hold pending state dispatches
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced dispatch to avoid updating store on every keystroke
  const handleNoteChange = useCallback(
    (html: string) => {
      if (!selectedNote) return;

      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      updateTimeoutRef.current = setTimeout(() => {
        dispatch({
          type: 'UPDATE_NOTE',
          payload: { id: selectedNote.id, body: html },
        });
      }, 300);
    },
    [dispatch, selectedNote]
  );

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
          onCreateNote={() => dispatch({ type: 'CREATE_NOTE' })}
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
          onTrashNote={(id) => dispatch({ type: 'TRASH_NOTE', payload: { id } })}
          onNoteChange={handleNoteChange}
        />
      </HStack>
    </SafeAreaView>
  );
}
