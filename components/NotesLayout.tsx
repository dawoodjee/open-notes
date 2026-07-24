import React, { useReducer, useState, useRef, useEffect, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlatList, Platform, Text as RNText, View } from 'react-native';
import RichEditor from './RichEditor'; // Ensure path matches your project structure

// Gluestack UI Primitives
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Pressable } from '@/components/ui/pressable';
import { Input, InputField, InputSlot, InputIcon } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { Box } from '@/components/ui/box';

import {
  Menu as UIComponentsMenu,
  MenuItem,
  MenuItemLabel,
} from '@/components/ui/menu';

// Lucide Icons
import {
  Search,
  SquarePen,
  ChevronLeft,
  Share,
  Menu,
  Trash2,
  MoreVertical,
} from 'lucide-react-native';

// Custom Types & Helpers
import {
  Note,
  NotesState,
  NotesAction,
  parseNoteContent,
  formatNoteDate,
} from '@/types/note';

// =============================================================================
// INITIAL STATE & REDUCER
// =============================================================================

const INITIAL_NOTES: Note[] = [
  {
    id: '1',
    body: 'MVP Build Plan<br>The frictionless experience of Apple Notes, the data sovereignty of Obsidian, and the extensibility of Notion.',
    title: 'MVP Build Plan',
    createdAt: new Date(),
    updatedAt: new Date(),
    isSynced: true,
    version: 1,
    isTrashed: false,
    trashedAt: null,
  },
  {
    id: '2',
    body: '<h1>Supabase Architecture</h1><p>Row Level Security and Postgres schemas for local-first sync using PowerSync.</p>',
    title: 'Supabase Architecture',
    createdAt: new Date(Date.now() - 86400000 * 2),
    updatedAt: new Date(Date.now() - 86400000 * 2),
    isSynced: true,
    version: 1,
    isTrashed: false,
    trashedAt: null,
  },
  {
    id: '3',
    body: "<h1>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</h1>",
    title: 'Lorem Ipsum',
    createdAt: new Date(),
    updatedAt: new Date(),
    isSynced: true,
    version: 1,
    isTrashed: false,
    trashedAt: null,
  },
];

const initialNotesState: NotesState = {
  notes: INITIAL_NOTES,
  selectedNoteId: null,
  searchQuery: '',
};

function notesReducer(state: NotesState, action: NotesAction): NotesState {
  switch (action.type) {
    case 'CREATE_NOTE': {
      const defaultBody = '';
      const { title } = parseNoteContent(defaultBody);
      const newNote: Note = {
        id: Date.now().toString(),
        body: defaultBody,
        title,
        createdAt: new Date(),
        updatedAt: new Date(),
        isSynced: false,
        version: 1,
        isTrashed: false,
        trashedAt: null,
      };

      return {
        ...state,
        notes: [newNote, ...state.notes],
        selectedNoteId: newNote.id,
      };
    }

    case 'SELECT_NOTE': {
      return {
        ...state,
        selectedNoteId: action.payload.id,
      };
    }

    case 'UPDATE_NOTE': {
      const { id, body } = action.payload;
      const { title } = parseNoteContent(body);

      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === id
            ? {
                ...note,
                body,
                title,
                updatedAt: new Date(),
                isSynced: false,
                version: note.version + 1,
              }
            : note
        ),
      };
    }

    case 'TRASH_NOTE': {
      const targetId = action.payload.id;
      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === targetId
            ? {
                ...note,
                isTrashed: true,
                trashedAt: new Date(),
                updatedAt: new Date(),
                isSynced: false,
              }
            : note
        ),
        selectedNoteId:
          state.selectedNoteId === targetId ? null : state.selectedNoteId,
      };
    }

    case 'RESTORE_NOTE': {
      const targetId = action.payload.id;
      return {
        ...state,
        notes: state.notes.map((note) =>
          note.id === targetId
            ? {
                ...note,
                isTrashed: false,
                trashedAt: null,
                updatedAt: new Date(),
                isSynced: false,
              }
            : note
        ),
      };
    }

    case 'PERMANENT_DELETE_NOTE': {
      const targetId = action.payload.id;
      return {
        ...state,
        notes: state.notes.filter((note) => note.id !== targetId),
        selectedNoteId:
          state.selectedNoteId === targetId ? null : state.selectedNoteId,
      };
    }

    case 'EMPTY_TRASH': {
      return {
        ...state,
        notes: state.notes.filter((note) => !note.isTrashed),
        selectedNoteId: state.notes.find((n) => n.id === state.selectedNoteId)?.isTrashed
          ? null
          : state.selectedNoteId,
      };
    }

    case 'SET_SEARCH_QUERY': {
      return {
        ...state,
        searchQuery: action.payload.query,
      };
    }

    default:
      return state;
  }
}

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

  // Filter Active Notes (Excludes Trashed Notes)
  const activeNotes = notes.filter((n) => !n.isTrashed);

  const filteredNotes = activeNotes.filter(
    (n) =>
      n.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Timer ref to hold pending state dispatches
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced dispatch to avoid updating store on every keystroke
  const handleNoteChange = useCallback(
    (html: string) => {
      // Guard clause: stop if no note is selected
      if (!selectedNote) return;

      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      updateTimeoutRef.current = setTimeout(() => {
        dispatch({
          type: 'UPDATE_NOTE',
          payload: { id: selectedNote.id, body: html },
        });
      }, 300); // 300ms delay
    },
    [dispatch, selectedNote]
  );

  // Clear pending updates if the user switches to a different note
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
        {/* LEFT PANE: Note List                                      */}
        {/* ========================================================= */}
        <VStack
          style={
            Platform.OS === 'web' && !isSidebarTucked && selectedNoteId
              ? { width: sidebarWidth }
              : undefined
          }
          className={`
            border-r border-gray-200 bg-gray-50 shrink-0
            ${selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
            ${isSidebarTucked ? 'md:hidden' : 'md:w-80'}
          `}
        >
          {/* Header with Top-Right Avatar for Mobile/List view */}
          <HStack className="justify-between items-start p-4 pb-2">
            <VStack>
              <RNText className="text-3xl font-bold text-gray-900">All Notes</RNText>
              <RNText className="text-xs text-gray-500 font-medium mt-0.5">
                {filteredNotes.length} {filteredNotes.length === 1 ? 'Note' : 'Notes'}
              </RNText>
            </VStack>

            {/* Mobile/List Avatar */}
            <Pressable className="md:hidden w-8 h-8 rounded-full bg-lime-100 items-center justify-center border border-lime-300">
              <RNText className="text-xs font-bold text-lime-800">AD</RNText>
            </Pressable>
          </HStack>

          {/* Notes Scroll Area */}
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4 }}
            renderItem={({ item: note }) => {
              const { title, preview } = parseNoteContent(note.body);
              const isSelected = note.id === selectedNoteId;

              return (
                <Pressable
                  onPress={() => dispatch({ type: 'SELECT_NOTE', payload: { id: note.id } })}
                  className={`p-3 mb-2 rounded-xl transition-colors ${
                    isSelected ? 'bg-lime-100/80' : 'bg-white border border-gray-100'
                  }`}
                >
                  <RNText className="font-semibold text-base text-gray-900" numberOfLines={1}>
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
                      className="text-xs text-gray-500 font-medium"
                      style={{ flexShrink: 0 }}
                    >
                      {formatNoteDate(note.updatedAt)}
                      {"  "}
                    </RNText>

                    <RNText
                      className="text-xs text-gray-500"
                      style={{ flex: 1, minWidth: 0 }}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {preview}
                    </RNText>
                  </View>
                </Pressable>
              );
            }}
          />

          {/* Bottom Controls */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 12,
              gap: 12,
              backgroundColor: '#F9FAFB',
              borderTopWidth: 1,
              borderTopColor: '#E5E7EB',
              width: '100%',
            }}
          >
            <Input className="flex-1 rounded-full bg-white border-gray-300 h-10 px-3">
              <InputSlot>
                <InputIcon as={Search} className="text-gray-400 ml-1 shrink-0" />
              </InputSlot>
              <InputField
                placeholder="Search"
                value={searchQuery}
                onChangeText={(text) => dispatch({ type: 'SET_SEARCH_QUERY', payload: { query: text } })}
                className="text-sm text-gray-800 flex-1 min-w-0"
              />
            </Input>

            <Pressable
              onPress={() => dispatch({ type: 'CREATE_NOTE' })}
              className="w-10 h-10 rounded-full bg-lime-500 items-center justify-center active:bg-lime-600 shadow-sm shrink-0"
            >
              <Icon as={SquarePen} className="text-white w-5 h-5" />
            </Pressable>
          </View>
        </VStack>

        {/* ========================================================= */}
        {/* DESKTOP RESIZE HANDLE BAR                                 */}
        {/* ========================================================= */}
        {Platform.OS === 'web' && !isSidebarTucked && selectedNoteId && (
          <div
            onMouseDown={startResizing}
            className="hidden md:block w-1 hover:w-1.5 cursor-col-resize bg-transparent hover:bg-lime-400 transition-all z-10"
            title="Drag to resize panel"
          />
        )}

        {/* ========================================================= */}
        {/* RIGHT PANE: Editor                                         */}
        {/* ========================================================= */}
        <VStack
          className={`
            flex-1 bg-white
            ${!selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'}
          `}
        >
          {selectedNote ? (
            <>
              {/* Top Navigation Row */}
              <HStack className="justify-between items-center px-4 py-3 border-b border-gray-100">
                <HStack className="items-center space-x-1">
                  {/* Mobile Back Button */}
                  <Pressable
                    onPress={() => dispatch({ type: 'SELECT_NOTE', payload: { id: null } })}
                    className="md:hidden flex-row items-center"
                  >
                    <Icon as={ChevronLeft} className="text-gray-600 w-6 h-6" />
                  </Pressable>

                  {/* Desktop Sidebar Tuck/Untuck Toggle */}
                  <Pressable
                    onPress={() => setIsSidebarTucked(!isSidebarTucked)}
                    className="hidden md:flex p-1.5 rounded-md hover:bg-gray-100"
                  >
                    <Icon as={Menu} className="text-gray-600 w-5 h-5" />
                  </Pressable>
                </HStack>

                {/* Header Actions */}
                <HStack className="items-center space-x-3">
                  {/* Share Action */}
                  <Pressable className="p-1.5 rounded-full hover:bg-gray-100">
                    <Icon as={Share} className="text-gray-600 w-5 h-5" />
                  </Pressable>

                  {/* More Options (...) Menu */}
                  <UIComponentsMenu
                    placement="bottom right"
                    offset={8}
                    trigger={({ ...triggerProps }) => (
                      <Pressable
                        {...triggerProps}
                        className="p-1.5 rounded-full hover:bg-gray-100 mr-2"
                      >
                        <Icon as={MoreVertical} className="text-gray-600 w-5 h-5" />
                      </Pressable>
                    )}
                  >
                    <MenuItem
                      key="trash"
                      textValue="Delete"
                      onPress={() =>
                        selectedNote &&
                        dispatch({ type: 'TRASH_NOTE', payload: { id: selectedNote.id } })
                      }
                      className="p-2.5 flex-row items-center gap-2"
                    >
                      <Icon as={Trash2} className="text-red-500 w-4 h-4" />
                      <MenuItemLabel className="text-sm font-medium text-red-600">
                        Delete
                      </MenuItemLabel>
                    </MenuItem>
                  </UIComponentsMenu>

                  {/* Desktop Avatar */}
                  <Pressable className="hidden md:flex w-8 h-8 rounded-full bg-lime-100 items-center justify-center border border-lime-300">
                    <RNText className="text-xs font-bold text-lime-800">AD</RNText>
                  </Pressable>
                </HStack>
              </HStack>

              {/* Editor Detail Pane */}
              <Box className="flex-1">
                <RichEditor
                  key={selectedNote.id}
                  initialContent={selectedNote.body}
                  onChange={handleNoteChange}
                  autoFocus={!selectedNote.body || selectedNote.body === ''}
                />
              </Box>
            </>
          ) : (
            <VStack className="flex-1 items-center justify-center p-4 bg-gray-50/50">
              <RNText className="text-gray-400 text-base font-medium">
                Select a note or create a new one.
              </RNText>
            </VStack>
          )}
        </VStack>
      </HStack>
    </SafeAreaView>
  );
}
