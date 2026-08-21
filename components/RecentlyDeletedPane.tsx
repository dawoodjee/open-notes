import React, { useState } from 'react';
import { FlatList, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { RotateCcw, ChevronLeft } from 'lucide-react-native';
import { PressableScale } from './PressableScale';
import { HeaderCircleButton } from './HeaderCircleButton';
import { Note, formatNoteDate, parseNoteContent } from '@/types/note';
import { TRASH_RETENTION_DAYS } from '@/lib/powersync/db';

/**
 * Recently Deleted.
 *
 * This closes a real gap rather than adding a feature: restoreNoteInDB and
 * emptyTrashInDB have existed and been tested since the MVP, but nothing in
 * the UI called either one -- so from the user's side, trashing a note was
 * permanent and irreversible. Everything here routes to those two functions;
 * neither is reimplemented.
 *
 * The retention notice is stated up front rather than buried in settings,
 * because it is the one thing about this screen a user cannot discover by
 * looking: notes here are on a timer.
 */
export function RecentlyDeletedPane({
  notes,
  selectedNoteId,
  onSelectNote,
  onRestoreNote,
  onEmptyTrash,
  onOpenFolders,
  useCompactHeader,
}: {
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onRestoreNote: (id: string) => void;
  onEmptyTrash: () => void;
  /** Undefined only where the folder pane is already permanently on screen. */
  onOpenFolders?: () => void;
  /** True on phones. Decides the header shape, same as NoteListPane. */
  useCompactHeader: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  return (
    <View className="flex-1 bg-secondary" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-4 pb-2">
        {/* Same two-shape header as NoteListPane, and for the same reason --
            see the long note there. Without a back control at all this screen
            was a dead end on a phone: the folder button lives in the list
            pane's header, and this pane replaces that pane outright. */}
        {useCompactHeader && onOpenFolders ? (
          <View className="flex-row justify-between items-center mb-2">
            <HeaderCircleButton
              icon={ChevronLeft}
              accessibilityLabel="Back to folders"
              onPress={onOpenFolders}
            />
          </View>
        ) : null}

        <View className="flex-row items-start justify-between">
          <View className="flex-1 min-w-0">
            <RNText
              className="text-3xl font-bold text-foreground"
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Recently Deleted
            </RNText>
            <RNText className="text-xs text-muted-foreground font-medium mt-0.5">
              {notes.length} {notes.length === 1 ? 'Note' : 'Notes'}
            </RNText>
          </View>

          {notes.length > 0 ? (
            <PressableScale
              onPress={() => setConfirmingEmpty(true)}
              style={{ minHeight: 44, justifyContent: 'center' }}
              className="px-3 rounded-xl"
              accessibilityRole="button"
              accessibilityLabel="Empty trash"
            >
              <RNText className="text-base text-destructive font-medium">Empty</RNText>
            </PressableScale>
          ) : null}
        </View>

        {notes.length > 0 ? (
          <RNText className="text-xs text-muted-foreground mt-2">
            Notes here are deleted permanently after {TRASH_RETENTION_DAYS} days.
          </RNText>
        ) : null}
      </View>

      {notes.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <RNText className="text-base text-muted-foreground text-center">
            Nothing here. Notes you delete stay for {TRASH_RETENTION_DAYS} days before they
            go for good.
          </RNText>
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4 }}
          renderItem={({ item: note }) => {
            const { title, preview } = parseNoteContent(note.body);
            const isSelected = note.id === selectedNoteId;

            return (
              <View className="flex-row items-center mb-2 gap-2">
                <PressableScale
                  onPress={() => onSelectNote(note.id)}
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  className={`p-3 rounded-xl ${
                    isSelected
                      ? 'bg-lime-100/80 dark:bg-lime-900/40'
                      : 'bg-card border border-border'
                  }`}
                >
                  <RNText
                    className="font-semibold text-base text-foreground"
                    numberOfLines={1}
                  >
                    {title}
                  </RNText>
                  <View className="flex-row items-center mt-1" style={{ minWidth: 0 }}>
                    <RNText
                      className="text-xs text-muted-foreground font-medium"
                      style={{ flexShrink: 0 }}
                    >
                      {/* trashedAt, not updatedAt: on this screen the useful
                          date is when it was deleted, since that is what the
                          30-day clock runs from. */}
                      {note.trashedAt ? formatNoteDate(new Date(note.trashedAt)) : ''}
                      {'  '}
                    </RNText>
                    <RNText
                      className="text-xs text-muted-foreground"
                      style={{ flex: 1, minWidth: 0 }}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {preview}
                    </RNText>
                  </View>
                </PressableScale>

                <PressableScale
                  onPress={() => onRestoreNote(note.id)}
                  style={{ minHeight: 44, minWidth: 44 }}
                  className="items-center justify-center rounded-xl bg-card border border-border"
                  accessibilityRole="button"
                  accessibilityLabel={`Restore ${title}`}
                >
                  <Icon as={RotateCcw} className="w-5 h-5 text-foreground" />
                </PressableScale>
              </View>
            );
          }}
        />
      )}

      {confirmingEmpty ? (
        <View className="absolute inset-0 items-center justify-center px-8 bg-black/40">
          <View className="w-full max-w-sm rounded-2xl bg-background p-6">
            <RNText className="text-lg font-semibold text-foreground mb-2">
              Delete Everything?
            </RNText>
            {/* Says "permanently" because this time it IS permanent -- unlike
                the folder-delete warning, where the notes survive in here. */}
            <RNText className="text-sm text-muted-foreground mb-5">
              {notes.length} {notes.length === 1 ? 'note' : 'notes'} will be deleted
              permanently. This cannot be undone.
            </RNText>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <PressableScale
                onPress={() => setConfirmingEmpty(false)}
                containerStyle={{ flex: 1 }}
                style={{ minHeight: 48 }}
                className="rounded-2xl items-center justify-center bg-secondary"
                accessibilityRole="button"
              >
                <RNText className="text-foreground font-medium">Cancel</RNText>
              </PressableScale>
              <PressableScale
                onPress={() => {
                  setConfirmingEmpty(false);
                  onEmptyTrash();
                }}
                containerStyle={{ flex: 1 }}
                style={{ minHeight: 48 }}
                className="rounded-2xl items-center justify-center bg-secondary"
                accessibilityRole="button"
              >
                <RNText className="text-destructive font-semibold">Delete All</RNText>
              </PressableScale>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
