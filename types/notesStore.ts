import { NotesState, NotesAction } from './note';

export const initialNotesState: NotesState = {
  notes: [],
  selectedNoteId: null,
  searchQuery: '',
  isLoading: true,
};

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
  switch (action.type) {
    case 'SET_NOTES': {
      const newNotes = action.payload.notes;

      // Instant-open logic: auto select first non-trashed note if the current
      // selection no longer exists (e.g. it was just trashed, or this is first load)
      let nextSelectedId = state.selectedNoteId;
      const activeNotes = newNotes.filter((n) => !n.isTrashed);

      if (
        (!nextSelectedId || !newNotes.some((n) => n.id === nextSelectedId)) &&
        activeNotes.length > 0
      ) {
        nextSelectedId = activeNotes[0].id;
      }

      return {
        ...state,
        notes: newNotes,
        selectedNoteId: nextSelectedId,
        isLoading: false,
      };
    }

    case 'SELECT_NOTE': {
      return {
        ...state,
        selectedNoteId: action.payload.id,
      };
    }

    case 'SET_SEARCH_QUERY': {
      return {
        ...state,
        searchQuery: action.payload.query,
      };
    }

    case 'SET_LOADING': {
      return {
        ...state,
        isLoading: action.payload.isLoading,
      };
    }

    default:
      return state;
  }
}
