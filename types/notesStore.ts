import { NotesState, NotesAction } from './note';

export const initialNotesState: NotesState = {
  notes: [],
  selectedNoteId: null,
  searchQuery: '',
  hasAutoSelected: false,
};

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
  switch (action.type) {
    case 'SET_NOTES': {
      const newNotes = action.payload.notes;

      // Instant-open on launch: with nothing selected, open the most recently
      // updated note rather than showing a list the user then has to tap.
      //
      // ONCE PER SESSION, and that limit is the whole point. This used to run
      // on every batch, which meant a selection of null was re-filled the
      // instant the next watch tick arrived -- so "back to list" bounced
      // straight back into the editor and, on mobile (where the list is hidden
      // whenever a note is open), the list was effectively unreachable. Null
      // has to be able to mean "the user deliberately closed the note", and it
      // cannot mean that if something keeps overwriting it.
      //
      // It also deliberately does NOT clear an existing selection just because
      // this batch doesn't contain it yet -- a note optimistically selected
      // right after creation won't appear in the very next watch() tick if
      // that tick was already in flight before the insert committed, and
      // clearing on that transient miss would flash the editor open then shut.
      // Genuinely-stale selections (a leftover ui_state.last_opened_note_id
      // pointing at nothing) are handled once, explicitly, at boot.
      let nextSelectedId = state.selectedNoteId;
      let hasAutoSelected = state.hasAutoSelected;
      const activeNotes = newNotes.filter((n) => !n.isTrashed);

      if (!hasAutoSelected && !nextSelectedId && activeNotes.length > 0) {
        nextSelectedId = activeNotes[0].id;
        hasAutoSelected = true;
      }

      return {
        ...state,
        notes: newNotes,
        selectedNoteId: nextSelectedId,
        hasAutoSelected,
      };
    }

    case 'SELECT_NOTE': {
      // Any explicit selection -- including closing a note -- retires the
      // instant-open rule. Opening a note by hand means the launch decision
      // has been made; closing one means it has been overruled.
      return {
        ...state,
        selectedNoteId: action.payload.id,
        hasAutoSelected: true,
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
