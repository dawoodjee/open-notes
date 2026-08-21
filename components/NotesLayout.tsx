import React, { useReducer, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Platform,
  AppState,
  BackHandler,
  View,
  useWindowDimensions,
} from 'react-native';
import NoteListPane from './NoteListPane';
import NoteEditorPane from './NoteEditorPane';
import DesktopResizeHandle from './DesktopResizeHandle';
import { FolderSidebar } from './FolderSidebar';
import { RecentlyDeletedPane } from './RecentlyDeletedPane';

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
  restoreNoteInDB,
  emptyTrashInDB,
  getUiState,
  saveUiState,
  isPowerSyncReady,
} from '@/lib/powersync/db';
import {
  createFolderInDB,
  deleteFolderInDB,
  mapRowToFolder,
  moveTopLevelFolder,
  renameFolderInDB,
  seedSkillsFolderIfSettled,
  setFolderGroupByDate,
  setFolderIncludeInNotes,
  setFolderEnabled,
  setSubtreeApiVisibility,
  subtreeApiVisibility,
  FOLDER_COLUMNS,
} from '@/lib/powersync/folders';
import type { SubtreeApiVisibility } from '@/lib/powersync/folders';
import {
  ALL_NOTES_SELECTION,
  Folder,
  FolderSelection,
  buildFolderTree,
  collectSubtreeIds,
  findNode,
} from '@/types/folder';
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
  const { session, isLoading: authLoading } = useAuth();
  const { scheme } = useTheme();
  const [state, dispatch] = useReducer(notesReducer, initialNotesState);
  const { notes, selectedNoteId, searchQuery } = state;

  const [isSidebarTucked, setIsSidebarTucked] = useState<boolean>(false);

  // --- Folders -------------------------------------------------------------
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selection, setSelection] = useState<FolderSelection>(ALL_NOTES_SELECTION);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Mobile only: the folder pane is a separate screen rather than a third
  // column, so it needs its own visibility. Desktop/tablet ignore this.
  const [isFolderPaneOpen, setIsFolderPaneOpen] = useState<boolean>(false);
  // Wide layouts only: the persistent folder pane can be tucked away, the same
  // way the note list already can. Separate state from isFolderPaneOpen, which
  // is the narrow-layout "am I on the folders screen" flag -- one is a
  // collapse, the other is navigation.
  const [isFolderSidebarCollapsed, setIsFolderSidebarCollapsed] = useState(false);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // 768 is the `md:` breakpoint the rest of the app already uses. Above it,
  // both the folder pane and the list are on screen together.
  const isWideLayout = windowWidth >= 768;
  const isLandscape = windowWidth > windowHeight;

  /**
   * TWO QUESTIONS, NOT ONE. These used to be a single flag, and that was the
   * bug: it forced the header shape and the folder pane's presentation to
   * agree, when the iPad needs them to disagree.
   *
   *   useCompactHeader   is this a PHONE? Drives the header -- circular back
   *                      button stacked above the large title, versus a reveal
   *                      icon inline with it.
   *   foldersArePersistent  does the folder pane PUSH content, or float over
   *                      it? True on desktop and a landscape iPad.
   *
   * iPad portrait therefore lands where the reference puts it: the wide header,
   * with the folder panel floating over the content rather than replacing it.
   *
   * Both derive from the window rather than a device check -- an iPad in Split
   * View is genuinely narrow and should behave like one, which asking "is this
   * an iPad" gets wrong.
   */
  const useCompactHeader = !isWideLayout;
  const foldersArePersistent = isWideLayout && (Platform.OS !== 'ios' || isLandscape);
  /** Wide but not persistent: the floating-panel case (iPad portrait). */
  const foldersOverlay = isWideLayout && !foldersArePersistent;

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

  // The auth state, mirrored where a callback can read it. The watch callback
  // is registered once and would otherwise capture the first render's values
  // forever -- the same reason createNoteRef exists below.
  const authRef = useRef({ isLoading: true, signedIn: false });
  authRef.current = { isLoading: authLoading, signedIn: session !== null };

  // Same problem, same fix: handleCreateNote is held in a ref by the watch
  // callback, so reading `selection` from its closure would pin it to whatever
  // was selected on the first render -- and new notes would file themselves
  // into a folder the user left ten minutes ago.
  const selectionRef = useRef<FolderSelection>(ALL_NOTES_SELECTION);
  selectionRef.current = selection;

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

  // Whether initPowerSync() has finished. State, not a ref, because the
  // auto-create effect below has to re-run the moment it flips -- getPowerSync()
  // throws until then, and the effect can otherwise land on either side of it.
  const [dbReady, setDbReady] = useState(false);

  const handleCreateNote = useCallback(async () => {
    try {
      // A new note is filed where you are. From All Notes or Recently Deleted
      // -- neither of which is a container -- it is unfiled, which is exactly
      // what All Notes then shows.
      const newNote = await createNoteInDB(
        selectionRef.current.kind === 'folder' ? selectionRef.current.id : null
      );
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

  /**
   * Does an empty notes table actually mean "this user has no notes"?
   *
   * It very often does not, and assuming otherwise is what manufactured blank
   * notes. initPowerSync() only opens the local file; connect() happens later
   * and elsewhere (AuthContext's claimAndConnect). So on any launch where local
   * storage starts empty -- a fresh install, or the first launch after a
   * sign-out cleared it -- the watch below necessarily fires on an empty table
   * BEFORE a single row has come down from the server. Treating that as "no
   * notes" created a note, and sync then uploaded it: one permanent blank note
   * per such launch, on every device the account touches.
   *
   * Three states, and only the last two can be trusted:
   *   auth still resolving -> answer nothing yet. Session restore is async, so
   *                           a signed-in user looks signed out for a moment.
   *   signed out           -> local SQLite IS the whole truth. Nothing is
   *                           coming, so an empty table is real.
   *   signed in            -> wait for the first sync to complete. hasSynced
   *                           is PowerSync's own "I have caught up" flag.
   */
  const emptyDatabaseIsTrustworthy = useCallback((): boolean => {
    if (!isPowerSyncReady()) return false;
    if (authRef.current.isLoading) return false;
    if (!authRef.current.signedIn) return true;
    return getPowerSync().currentStatus.hasSynced === true;
  }, []);

  /**
   * Land the user in a note when there is genuinely nothing to show.
   *
   * Called from three places, because the question "is the database really
   * empty?" can become answerable at three different moments: when notes
   * arrive (the watch), when auth resolves, and when the first sync completes.
   * Whichever gets there first wins; hasAutoCreatedRef makes the other two
   * no-ops.
   *
   * That ref never resets, and it is not optional: discardIfEmpty deletes the
   * note you leave, so without it every return to the list would delete this
   * note, observe an empty database, and create another one -- forever. Once
   * per launch means the user can still genuinely reach an empty list by
   * trashing their last note by hand.
   */
  const autoCreateIfTrulyEmpty = useCallback(async () => {
    if (hasAutoCreatedRef.current) return;
    if (!emptyDatabaseIsTrustworthy()) return;

    // Re-read from SQLite rather than trusting a count passed in from a
    // caller: the two async callers can arrive long after their snapshot was
    // taken, and the whole point of this function is not to act on a stale
    // reading of "empty".
    const row = await getPowerSync().get<{ count: number }>(
      'SELECT count(*) as count FROM notes WHERE is_trashed = 0'
    );
    if (row.count > 0) {
      setLaunchSettled(true);
      return;
    }

    hasAutoCreatedRef.current = true;
    // Stay gated across the insert: the note this creates is what the user is
    // meant to land in, and it only reaches `notes` on a later tick. Releasing
    // here would paint the empty list for exactly one INSERT round-trip. If the
    // insert fails there is nothing left to wait for, so release.
    const created = await createNoteRef.current();
    if (!created) setLaunchSettled(true);
  }, [emptyDatabaseIsTrustworthy]);

  // Re-ask once auth has resolved, and again once the first sync lands. Both
  // are moments the watch cannot observe on its own: an account that genuinely
  // has no notes produces no rows, so no further watch tick ever arrives, and
  // without this the launch would sit on the gate until the failsafe fires.
  useEffect(() => {
    // dbReady rather than isPowerSyncReady() alone: this effect has to RE-RUN
    // when the database finishes opening, and only a state value does that.
    if (!dbReady || authLoading) return;
    void autoCreateIfTrulyEmpty().catch((err) =>
      console.error('Auto-create check failed:', err)
    );
    // Same three-state question as autoCreateIfTrulyEmpty, and answered in the
    // same place for the same reason: an empty folders table only means "this
    // account has no Skills folder" once nothing is still in flight. Seeding
    // early produces a duplicate that then syncs.
    void seedSkillsFolderIfSettled({
      authLoading,
      signedIn: session !== null,
      hasSynced: getPowerSync().currentStatus.hasSynced === true,
    }).catch((err) => console.error('Skills seed failed:', err));

    if (!session) return;
    const ac = new AbortController();
    void getPowerSync()
      .waitForFirstSync(ac.signal)
      .then(() => {
        if (ac.signal.aborted) return;
        void seedSkillsFolderIfSettled({
          authLoading: false,
          signedIn: true,
          hasSynced: true,
        }).catch((err) => console.error('Skills seed failed:', err));
        return autoCreateIfTrulyEmpty();
      })
      .catch(() => {
        // A sync that never completes -- offline, or blocked -- must not hold
        // the launch gate. Showing an honest empty list beats inventing a note.
        setLaunchSettled(true);
      });
    return () => ac.abort();
  }, [dbReady, authLoading, session, autoCreateIfTrulyEmpty]);

  // PowerSync local SQLite init + live watch query.
  // The watch callback is the *only* place notes state gets set — the reducer
  // just mirrors whatever SQLite currently reports, it doesn't own the data.
  useEffect(() => {
    const abortController = new AbortController();

    async function setupDatabase() {
      try {
        await initPowerSync();
        setDbReady(true);

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

        // Folders get their own watch rather than being read once: a folder
        // created on another device has to appear here without a relaunch,
        // exactly as a note does.
        getPowerSync().watch(
          `SELECT ${FOLDER_COLUMNS} FROM folders ORDER BY sort_order ASC, created_at ASC`,
          [],
          {
            onResult: (result) => setFolders(result.array.map(mapRowToFolder)),
            onError: (err) => console.error('PowerSync folder watch error:', err),
          },
          { signal: abortController.signal }
        );

        getPowerSync().watch(
          'SELECT * FROM notes ORDER BY updated_at DESC',
          [],
          {
            onResult: (result) => {
              const notes = result.array.map(mapRowToNote);
              dispatch({ type: 'SET_NOTES', payload: { notes } });

              // Landing on an empty database means landing on a blank list
              // with nothing to read and nothing to do. Open a note instead,
              // the way Apple Notes does -- but only once it is clear the
              // database really is empty. See autoCreateIfTrulyEmpty.
              const activeCount = notes.filter((n) => !n.isTrashed).length;

              if (activeCount > 0 || hasAutoCreatedRef.current) {
                // Either a note is on screen, or the one auto-create this
                // launch gets has already been spent -- nothing further is
                // coming either way.
                setLaunchSettled(true);
                return;
              }

              // Empty, and nothing created yet. This either creates the
              // landing note or declines because the server hasn't been heard
              // from; declining deliberately leaves the gate held, and the
              // failsafe below covers a sync that never lands.
              void autoCreateIfTrulyEmpty().catch((err) =>
                console.error('Auto-create check failed:', err)
              );
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
  }, [autoCreateIfTrulyEmpty]);

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

  // --- Derived folder state -------------------------------------------------

  const activeNotes = useMemo(() => notes.filter((n) => !n.isTrashed), [notes]);
  const trashedNotes = useMemo(
    () =>
      notes
        .filter((n) => n.isTrashed)
        // Most recently deleted first: this list is read newest-down, and it
        // is also the order the 30-day clock runs out in, from the bottom up.
        .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '')),
    [notes]
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of activeNotes) {
      if (!note.folderId) continue;
      counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1);
    }
    return counts;
  }, [activeNotes]);

  const folderTree = useMemo(
    () => buildFolderTree(folders, folderCounts),
    [folders, folderCounts]
  );

  const excludedFolderIds = useMemo(
    () => new Set(folders.filter((f) => !f.includeInNotes).map((f) => f.id)),
    [folders]
  );

  /** The selected folder AND its descendants -- selecting a parent shows
   *  everything underneath it. Null when a virtual view is selected. */
  const visibleFolderIds = useMemo(() => {
    if (selection.kind !== 'folder') return null;
    return new Set(collectSubtreeIds(folderTree, selection.id));
  }, [selection, folderTree]);

  const allNotesCount = useMemo(
    () =>
      activeNotes.filter((n) => n.folderId === null || !excludedFolderIds.has(n.folderId))
        .length,
    [activeNotes, excludedFolderIds]
  );

  const folderTitle = useMemo(() => {
    if (selection.kind === 'all') return 'All Notes';
    if (selection.kind === 'trash') return 'Recently Deleted';
    const node = findNode(folderTree, selection.id);
    if (!node) return 'Folder';
    return node.folder.decryptFailed ? 'Unreadable folder' : node.folder.name || 'New Folder';
  }, [selection, folderTree]);

  /**
   * A folder that disappears -- deleted here, or deleted on another device and
   * synced in -- must not leave the list pane pointing at nothing. Falling back
   * to All Notes is the only selection guaranteed to exist.
   *
   * Waits for `folders` to be non-empty before acting: at launch the watch
   * fires once with an empty array before any row arrives, and reacting to
   * that would reset a perfectly valid restored selection.
   */
  useEffect(() => {
    if (selection.kind !== 'folder' || folders.length === 0) return;
    if (!folders.some((f) => f.id === selection.id)) {
      setSelection(ALL_NOTES_SELECTION);
    }
  }, [folders, selection]);

  const handleSelectFolder = useCallback((next: FolderSelection) => {
    setSelection(next);
    // On mobile the folder pane is a screen, so choosing something is also
    // leaving it. On desktop it stays put -- there is nothing to close.
    setIsFolderPaneOpen(false);
  }, []);

  const handleToggleExpanded = useCallback((folderId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handleCreateFolder = useCallback(
    async (parentId: string | null, name: string) => {
      try {
        await createFolderInDB({ name, parentId });
        // Open the parent so the new folder is visible rather than created
        // into a collapsed branch, where it looks like nothing happened.
        if (parentId) setExpandedIds((prev) => new Set(prev).add(parentId));
      } catch (err) {
        console.error('Failed to create folder:', err);
      }
    },
    []
  );

  const handleRenameFolder = useCallback(async (folderId: string, name: string) => {
    try {
      await renameFolderInDB(folderId, name);
    } catch (err) {
      console.error('Failed to rename folder:', err);
    }
  }, []);

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      try {
        await deleteFolderInDB(folderId);
        // The effect above would catch this once the watch ticks, but doing it
        // here too means the list pane never paints a frame showing a folder
        // that no longer exists.
        if (selection.kind === 'folder' && selection.id === folderId) {
          setSelection(ALL_NOTES_SELECTION);
        }
      } catch (err) {
        console.error('Failed to delete folder:', err);
      }
    },
    [selection]
  );

  const handleToggleIncludeInNotes = useCallback(async (folderId: string, next: boolean) => {
    try {
      await setFolderIncludeInNotes(folderId, next);
    } catch (err) {
      console.error('Failed to change Include in Notes:', err);
    }
  }, []);

  const handleToggleGroupByDate = useCallback(async (folderId: string, next: boolean) => {
    try {
      await setFolderGroupByDate(folderId, next);
    } catch (err) {
      console.error('Failed to change Group By Date:', err);
    }
  }, []);

  const [skillsApiVisibility, setSkillsApiVisibility] =
    useState<SubtreeApiVisibility | undefined>(undefined);

  const skillsFolderId = useMemo(
    () => folders.find((f) => f.kind === 'skills')?.id ?? null,
    [folders]
  );

  // Recomputed whenever the notes change, because the aggregate is a fact about
  // the notes and the context menu must not offer a bulk write based on a stale
  // reading of what it is about to overwrite.
  useEffect(() => {
    if (!dbReady || !skillsFolderId) return;
    let cancelled = false;
    void subtreeApiVisibility(skillsFolderId)
      .then((state) => {
        if (!cancelled) setSkillsApiVisibility(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dbReady, skillsFolderId, notes]);

  const handleSetFolderEnabled = useCallback(
    async (folderId: string, enabled: boolean) => {
      try {
        await setFolderEnabled(folderId, enabled);
        // A disabled folder leaves the sidebar, so a selection pointing into it
        // would strand the list pane on a folder the user can no longer see.
        if (!enabled && selection.kind === 'folder') {
          const disabled = collectSubtreeIds(folderTree, folderId);
          if (disabled.includes(selection.id)) setSelection(ALL_NOTES_SELECTION);
        }
      } catch (err) {
        console.error('Failed to change folder enabled state:', err);
      }
    },
    [selection, folderTree]
  );

  const handleSetSubtreeApiVisibility = useCallback(
    async (folderId: string, visible: boolean) => {
      try {
        await setSubtreeApiVisibility(folderId, visible);
      } catch (err) {
        console.error('Failed to change folder API visibility:', err);
      }
    },
    []
  );

  const handleMoveFolder = useCallback(async (folderId: string, direction: -1 | 1) => {
    try {
      await moveTopLevelFolder(folderId, direction);
    } catch (err) {
      console.error('Failed to reorder folder:', err);
    }
  }, []);

  const handleRestoreNote = useCallback(async (id: string) => {
    try {
      await restoreNoteInDB(id);
    } catch (err) {
      console.error('Failed to restore note:', err);
    }
  }, []);

  const handleEmptyTrash = useCallback(async () => {
    try {
      await emptyTrashInDB();
    } catch (err) {
      console.error('Failed to empty trash:', err);
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
        leaveNote(null);
        return true;
      }
      // The folder pane is a screen on narrow layouts, so back has to leave it
      // -- otherwise opening folders and pressing back exits the app, which
      // reads as the app crashing.
      if (isFolderPaneOpen && !foldersArePersistent) {
        setIsFolderPaneOpen(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [selectedNoteId, leaveNote, isFolderPaneOpen, foldersArePersistent]);

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
    // Full-bleed, NOT a SafeAreaView, and that is the whole fix for the bands
    // at the top and bottom of the screen.
    //
    // SafeAreaView insets its children and paints the inset strips ITSELF, with
    // whatever colour it was given -- here the app background. But the content
    // inside is a different colour: the list pane is bg-secondary and the
    // bottom bar is its own near-white. So the notch got a white strip above a
    // grey list, and the home indicator a white strip below an off-white bar.
    // Two near-misses, which is why it read as an unfinished gap rather than an
    // obvious border.
    //
    // Instead the panes now run edge to edge and each piece of chrome pads
    // ITSELF by the inset (see NoteListPane and NoteEditorPane). Each
    // background therefore reaches the screen edge and there is nothing left to
    // mismatch -- which is also how iOS's own apps do it.
    <View style={{ flex: 1, backgroundColor: BACKGROUND[scheme] }}>
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
        {/* FOLDER PANE                                               */}
        {/*                                                           */}
        {/* Wide layouts show it beside the list permanently. Narrow  */}
        {/* ones treat it as a screen you go to and come back from,   */}
        {/* which is how the mobile reference behaves -- and it is    */}
        {/* the same conditional-pane approach the list/editor split  */}
        {/* already uses, rather than introducing a router stack for  */}
        {/* one destination.                                          */}
        {/* ========================================================= */}
        {/*
          THE `!selectedNoteId` GUARD USED TO LIVE HERE AND WAS THE iPAD BUG.
          It is correct on a phone -- the folder list and an open note are the
          same screen there, so showing folders over a note is ambiguous. On an
          iPad the panes coexist and the editor ALWAYS has a note open, so that
          condition was never true and the reveal control did nothing at all.
          Gated on the compact layout now, which is what it always meant.
        */}
        <FolderSidebar
          tree={folderTree}
          selection={selection}
          allNotesCount={allNotesCount}
          trashCount={trashedNotes.length}
          expandedIds={expandedIds}
          isVisible={
            foldersArePersistent
              ? !isFolderSidebarCollapsed
              : isFolderPaneOpen && (!useCompactHeader || !selectedNoteId)
          }
          isPersistent={foldersArePersistent}
          isOverlay={foldersOverlay}
          useCompactHeader={useCompactHeader}
          skillsApiVisibility={skillsApiVisibility}
          onSetFolderEnabled={handleSetFolderEnabled}
          onSetSubtreeApiVisibility={handleSetSubtreeApiVisibility}
          onDismiss={() => setIsFolderPaneOpen(false)}
          width={
            Platform.OS === 'web' && foldersArePersistent ? 288 : undefined
          }
          onSelect={handleSelectFolder}
          onToggleExpanded={handleToggleExpanded}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onToggleIncludeInNotes={handleToggleIncludeInNotes}
          onToggleGroupByDate={handleToggleGroupByDate}
          onMoveFolder={handleMoveFolder}
        />

        {/* ========================================================= */}
        {/* LEFT PANE: the note list, or Recently Deleted             */}
        {/* ========================================================= */}
        {/* Only a PHONE replaces the list with the folder screen. On an iPad
            the panel floats over it, so the list stays mounted underneath. */}
        {isFolderPaneOpen && useCompactHeader && !selectedNoteId ? null : selection.kind ===
          'trash' ? (
          <View
            className={`border-r border-border shrink-0 ${
              selectedNoteId ? 'hidden md:flex' : 'w-full flex-1'
            } ${isSidebarTucked ? 'md:hidden' : 'md:w-80'}`}
          >
            <RecentlyDeletedPane
              notes={trashedNotes}
              selectedNoteId={selectedNoteId}
              onSelectNote={(id) => leaveNote(id)}
              onRestoreNote={handleRestoreNote}
              onEmptyTrash={handleEmptyTrash}
              onOpenFolders={
                foldersArePersistent ? undefined : () => setIsFolderPaneOpen(true)
              }
              useCompactHeader={useCompactHeader}
            />
          </View>
        ) : (
          <NoteListPane
            notes={notes}
            selectedNoteId={selectedNoteId}
            searchQuery={searchQuery}
            isSidebarTucked={isSidebarTucked}
            sidebarWidth={sidebarWidth}
            selection={selection}
            folderTitle={folderTitle}
            excludedFolderIds={excludedFolderIds}
            visibleFolderIds={visibleFolderIds}
            onSelectNote={(id) => leaveNote(id)}
            onCreateNote={handleCreateNotePressed}
            onSearchChange={(query) =>
              dispatch({ type: 'SET_SEARCH_QUERY', payload: { query } })
            }
            onOpenFolders={
              foldersArePersistent ? undefined : () => setIsFolderPaneOpen(true)
            }
            useCompactHeader={useCompactHeader}
            onToggleSidebar={() => setIsFolderSidebarCollapsed((v) => !v)}
          />
        )}

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
    </View>
  );
}
