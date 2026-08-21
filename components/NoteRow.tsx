import React from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import { Check, Folder as FolderIcon } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';
import { parseNoteContent, formatNoteDate, type Note } from '@/types/note';

/**
 * One note in the list.
 *
 * Extracted from NoteListPane's inline `renderItem` in Stage 11. That was fine
 * while a row was a title and a date; it stopped being fine once the row also
 * had to know about grouping position, selection state, a folder line and a
 * swipe wrapper. It is also `React.memo`'d, which an inline arrow function can
 * never be -- with grouping and multi-select on top of a several-hundred-note
 * list, re-rendering every visible row on every keystroke shows.
 *
 * TWO SECTION CHROMES, ONE ROW. On a phone the reference draws each date group
 * as a rounded card with the header outside it; on desktop the rows sit flat on
 * the pane with hairline separators. That is a difference in how a GROUP is
 * drawn, not in what a row contains, so it arrives here as `variant` plus the
 * row's position in its section rather than as a second component.
 *
 * THE SEPARATOR IS INSET, and it gets that for free: it lives on the content
 * column, inside the horizontal padding and to the right of the select gutter,
 * so it always starts exactly where the text does however the row is
 * configured. Drawing it on the outer row would need the inset recomputed for
 * every combination.
 */

export interface NoteRowProps {
  note: Note;
  /** The note currently open in the editor. Not the same as being selected in
   *  multi-select mode -- see `isChecked`. */
  isOpen: boolean;
  /** Decrypted upstream. null = don't show the folder line at all (we're not
   *  in All Notes, so every row would say the same thing). */
  folderName: string | null;
  /** 'card' = phone, grouped rounded card. 'flat' = iPad/desktop. */
  variant: 'card' | 'flat';
  isFirstInSection: boolean;
  isLastInSection: boolean;
  isSelectMode: boolean;
  isChecked: boolean;
  onPress: () => void;
  onLongPress?: (anchor: { x: number; y: number }) => void;
}

function NoteRowInner({
  note,
  isOpen,
  folderName,
  variant,
  isFirstInSection,
  isLastInSection,
  isSelectMode,
  isChecked,
  onPress,
  onLongPress,
}: NoteRowProps) {
  const { title, preview } = parseNoteContent(note.body);

  // Right-click, web only -- RN has no context-menu event. Same split as
  // FolderRow: on iPad the long press below is the equivalent affordance, and
  // is kept even with a keyboard attached.
  const webContextMenu =
    Platform.OS === 'web' && onLongPress
      ? {
          onContextMenu: (event: any) => {
            event.preventDefault?.();
            onLongPress({ x: event.clientX ?? 0, y: event.clientY ?? 0 });
          },
        }
      : {};

  const handleLongPress = onLongPress
    ? (event: any) => {
        const { pageX = 0, pageY = 0 } = event?.nativeEvent ?? {};
        onLongPress({ x: pageX, y: pageY });
      }
    : undefined;

  // In card mode the group is one rounded block, so only the outer corners
  // round. A section of one note rounds both ends.
  const corners =
    variant === 'card'
      ? `${isFirstInSection ? 'rounded-t-xl' : ''} ${isLastInSection ? 'rounded-b-xl' : ''}`
      : 'rounded-xl';

  // The open note. Flat layouts get the accent border the reference draws;
  // card layouts get a tint instead, because a border inside a shared rounded
  // card cuts across the block. On a phone this is nearly moot anyway -- the
  // list is hidden while a note is open.
  const openTreatment = isOpen
    ? variant === 'flat'
      ? 'border border-lime-500 bg-lime-500/10'
      : 'bg-lime-500/10'
    : variant === 'card'
      ? 'bg-card'
      : 'border border-transparent';

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      // 500 rather than FolderRow's 400: the row is also a pan target now, and
      // a hold that fires while the finger is already sliding turns a swipe
      // into a context menu. Longer than the swipe's own recognition, so the
      // gesture that started first wins.
      style={{ paddingHorizontal: variant === 'card' ? 12 : 10 }}
      className={`${corners} ${openTreatment} ${isChecked ? 'bg-lime-500/15' : ''}`}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={isSelectMode ? { checked: isChecked } : { selected: isOpen }}
      {...webContextMenu}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {isSelectMode ? (
          <View style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
            <View
              className={
                isChecked
                  ? 'w-6 h-6 rounded-full bg-lime-500 items-center justify-center'
                  : 'w-6 h-6 rounded-full border-2 border-muted-foreground'
              }
            >
              {isChecked ? <Icon as={Check} className="w-4 h-4 text-on-accent" /> : null}
            </View>
          </View>
        ) : null}

        <View
          style={{
            flex: 1,
            minWidth: 0,
            // 44pt FLOOR, not a fixed height -- paddingVertical is what lets
            // the row grow instead of clipping when Dynamic Type makes three
            // lines taller than the minimum.
            minHeight: 44,
            paddingVertical: 10,
            borderBottomWidth: isLastInSection ? 0 : StyleSheet.hairlineWidth,
          }}
          className="border-border justify-center"
        >
          <RNText className="font-semibold text-base text-foreground" numberOfLines={1}>
            {title}
          </RNText>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 2,
              width: '100%',
              minWidth: 0,
            }}
          >
            <RNText
              className="text-xs text-muted-foreground font-medium"
              style={{ flexShrink: 0 }}
            >
              {formatNoteDate(new Date(note.updatedAt))}
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

          {/* The third row. Only rendered in All Notes, where "which folder is
              this in" is a real question -- inside a folder every row would
              give the same answer. The name arrives already decrypted:
              folders.name is ciphertext at rest, so this can never come from a
              SQL join, only from the folder list already in memory. */}
          {folderName !== null ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginTop: 2,
                minWidth: 0,
              }}
            >
              <Icon as={FolderIcon} className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <RNText
                className="text-xs text-muted-foreground"
                style={{ flex: 1, minWidth: 0 }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {folderName}
              </RNText>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

export const NoteRow = React.memo(NoteRowInner);
NoteRow.displayName = 'NoteRow';
