import { Note, NotesState, NotesAction, parseNoteContent } from './note';

export const INITIAL_NOTES: Note[] = [
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

export const initialNotesState: NotesState = {
  notes: INITIAL_NOTES,
  selectedNoteId: null,
  searchQuery: '',
};

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
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
