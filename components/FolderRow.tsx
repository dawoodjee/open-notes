import React, { useCallback, useMemo } from 'react';
import { IconButton, SURFACE } from './IconButton';
import { Text as RNText, View, Platform } from 'react-native';
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';
import { ChevronRight, ChevronUp, ChevronDown, Folder as FolderIcon, Trash2, Notebook, Scroll } from 'lucide-react-native';
import { DURATION, EASE, SPRING_EXPAND, spring } from '@/lib/theme/motion';
import type { FolderSelection } from '@/types/folder';

/**
 * One row in the folder sidebar -- real folder or virtual view, the same
 * component draws both, because to the user they are the same kind of thing.
 *
 * SIZING BY DEPTH. The reference screenshots shrink the folder glyph at each
 * nesting level rather than only indenting, which is what makes a deep tree
 * still readable at a glance -- indentation alone leaves five identical rows
 * marching rightwards. The text stays at its normal size throughout: shrinking
 * that too would fight Dynamic Type and fail the contrast/scaling work Stage 9
 * just landed.
 */

const INDENT_PER_LEVEL = 16;

/** 20px at top level down to 15px at level 4. Icon only -- never the label. */
function iconSizeForDepth(depth: number): number {
  return Math.max(20 - depth * 1.25, 15);
}

/**
 * The icon always occupies THIS much width, whatever size it is drawn at.
 *
 * Without it the glyph was laid out at its own shrinking width inside a `gap-2`
 * row, so every nesting level pulled its label 1.25pt further left than the
 * level above. The indent step is meant to be a clean 16pt; it was really
 * 14.75, and the labels down a nested tree stopped sharing a left edge. Barely
 * visible in a full-width phone sidebar, obvious in a 250pt iPad column, which
 * is where it was finally spotted.
 *
 * Equal to the largest icon, so nothing moves at top level.
 */
const ICON_SLOT = 20;

export interface FolderRowProps {
  label: string;
  /** 0 for top level and for both virtual rows. */
  depth: number;
  noteCount: number;
  isSelected: boolean;
  /** undefined = this row cannot have children (a leaf, or a virtual row). */
  isExpanded?: boolean;
  hasChildren: boolean;
  variant: 'all' | 'trash' | 'skills' | 'user';
  /** Editing mode: reorder controls replace the count, on top-level rows only. */
  isEditing?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /**
   * The drag handle, built by ReorderableFolderList because it owns the
   * gesture. Present only in edit mode, and when it is present it REPLACES the
   * up/down arrows -- three controls do not fit a 250pt iPad sidebar column,
   * and iOS puts a grip there rather than a pair of arrows.
   *
   * The arrows are not lost. `onMove` stays wired, and in edit mode this row
   * publishes it as VoiceOver actions instead (see accessibilityActions below):
   * a drag handle is unusable to a screen reader, so reordering would otherwise
   * become a sighted-only feature.
   */
  dragHandle?: React.ReactNode;
  onPress: () => void;
  onToggleExpanded?: () => void;
  onRequestMenu?: (anchor: { x: number; y: number }) => void;
  onMove?: (direction: -1 | 1) => void;
  selection?: FolderSelection;
}

export function FolderRow({
  label,
  depth,
  noteCount,
  isSelected,
  isExpanded,
  hasChildren,
  variant,
  isEditing = false,
  canMoveUp = false,
  canMoveDown = false,
  dragHandle,
  onPress,
  onToggleExpanded,
  onRequestMenu,
  onMove,
}: FolderRowProps) {
  const rotation = useSharedValue(isExpanded ? 90 : 0);

  React.useEffect(() => {
    // Rotating one chevron rather than swapping two glyphs: the turn is what
    // tells the user the row opened, and a swap has nothing to animate.
    // SPRING_EXPAND is the shared disclosure feel from Stage 9.
    rotation.value = spring(isExpanded ? 90 : 0, SPRING_EXPAND);
  }, [isExpanded, rotation]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handleLongPress = useCallback(
    (event: any) => {
      if (!onRequestMenu) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { pageX = 0, pageY = 0 } = event?.nativeEvent ?? {};
      onRequestMenu({ x: pageX, y: pageY });
    },
    [onRequestMenu]
  );

  // Right-click, web only. RN has no context-menu event, and on iPad the long
  // press above is the equivalent affordance -- kept there deliberately rather
  // than treating a Magic Keyboard as a reason to drop touch gestures.
  const webContextMenu =
    Platform.OS === 'web' && onRequestMenu
      ? {
          onContextMenu: (event: any) => {
            event.preventDefault?.();
            onRequestMenu({ x: event.clientX ?? 0, y: event.clientY ?? 0 });
          },
        }
      : {};

  const GlyphFor = { all: Notebook, trash: Trash2, skills: Scroll, user: FolderIcon }[variant];
  const iconSize = iconSizeForDepth(depth);

  /**
   * The keyboard/VoiceOver route to the same reorder the handle drags.
   *
   * Only offered where it would do something: an action in the rotor that
   * silently no-ops at the top of the list is worse than one that is absent,
   * because the rotor gives no other signal that it failed.
   */
  const reorderActions = useMemo(() => {
    if (!isEditing || !onMove) return undefined;
    const actions = [];
    if (canMoveUp) actions.push({ name: 'moveUp', label: 'Move up' });
    if (canMoveDown) actions.push({ name: 'moveDown', label: 'Move down' });
    return actions.length ? actions : undefined;
  }, [isEditing, onMove, canMoveUp, canMoveDown]);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: depth * INDENT_PER_LEVEL }}
    >
      <PressableScale
        onPress={onPress}
        onLongPress={onRequestMenu ? handleLongPress : undefined}
        delayLongPress={400}
        // flex:1 belongs on the PRESSABLE (containerStyle), not inside it --
        // this row is a flexDirection:'row' parent, so without it the row
        // sizes to its icon and count and the label collapses to nothing.
        containerStyle={{ flex: 1 }}
        // 44pt FLOOR, not a fixed height. Enforced here rather than by
        // padding, because RN does not grow a hit area from padding alone --
        // but paddingVertical is what lets the row grow past 44 when Dynamic
        // Type makes the label taller, instead of clipping its descenders.
        style={{ minHeight: 44, paddingVertical: 6 }}
        className={`flex-row items-center gap-2 px-3 rounded-xl ${
          isSelected ? 'bg-lime-500' : 'bg-transparent'
        }`}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`}
        accessibilityState={{ selected: isSelected, expanded: isExpanded }}
        accessibilityActions={reorderActions}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'moveUp') onMove?.(-1);
          if (event.nativeEvent.actionName === 'moveDown') onMove?.(1);
        }}
        {...webContextMenu}
      >
        {/* Fixed-width slot, glyph centred inside it -- see ICON_SLOT. Centred
            rather than left-aligned so the glyphs share an optical centre line
            down the tree, which is how the reference draws a nested sidebar. */}
        <View style={{ width: ICON_SLOT, alignItems: 'center' }}>
          <Icon
            as={GlyphFor}
            style={{ width: iconSize, height: iconSize }}
            className={isSelected ? 'text-on-accent' : 'text-lime-600 dark:text-lime-400'}
          />
        </View>

        {/* The label is wrapped rather than being flexed directly, because a
            bare <Text flex-1> did NOT shrink at large font scales -- it took
            its natural width and pushed the count off the row, where it
            rendered as a half-clipped glyph. Verified on Android at
            font_scale 1.6. A View is a reliable flex container in a way the
            Text was not. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText
            className={`text-base ${
              isSelected ? 'text-on-accent font-medium' : 'text-foreground'
            }`}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {label}
          </RNText>
        </View>

        {isEditing ? null : (
          <RNText
            className={`text-sm ${isSelected ? 'text-on-accent' : 'text-muted-foreground'}`}
            // The count is the row's one piece of data, so the NAME truncates
            // and this never does. minWidth reserves room for it before the
            // label is measured; textAlign keeps multi-digit counts aligned.
            style={{ flexShrink: 0, minWidth: 20, textAlign: 'right' }}
            numberOfLines={1}
          >
            {noteCount}
          </RNText>
        )}
      </PressableScale>

      {isEditing && dragHandle ? (
        dragHandle
      ) : isEditing ? (
        <View style={{ flexDirection: 'row' }}>
          <ReorderButton
            direction={-1}
            disabled={!canMoveUp}
            onPress={() => onMove?.(-1)}
            label={`Move ${label} up`}
          />
          <ReorderButton
            direction={1}
            disabled={!canMoveDown}
            onPress={() => onMove?.(1)}
            label={`Move ${label} down`}
          />
        </View>
      ) : hasChildren ? (
        // A separate hit target from the row: tapping the row OPENS the
        // folder, tapping the chevron EXPANDS it. Apple Notes makes the same
        // split, and conflating them means you cannot look inside a parent
        // without navigating away from where you are.
        <IconButton
          icon={ChevronRight}
          label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
          // Bare: a filled circle here would read as a button sitting ON the
          // row rather than part of it. It still gets the press inset, which
          // it never had before -- this was a plain Pressable with no pressed
          // state at all.
          surface="none"
          glyphStyle={chevronStyle}
          onPress={onToggleExpanded}
        />
      ) : (
        // Keeps every row's content on the same vertical line whether or not
        // it has a chevron. Without it, leaf rows' counts sit a whole control
        // width further right than their siblings'.
        <View style={{ width: SURFACE }} />
      )}
    </View>
  );
}

function ReorderButton({
  direction,
  disabled,
  onPress,
  label,
}: {
  direction: -1 | 1;
  disabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const opacity = useSharedValue(disabled ? 0.3 : 1);
  React.useEffect(() => {
    opacity.value = withTiming(disabled ? 0.3 : 1, {
      duration: DURATION.fast,
      easing: EASE.inOut,
    });
  }, [disabled, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <IconButton
      icon={direction === -1 ? ChevronUp : ChevronDown}
      label={label}
      // Bare for the same reason as the chevron: these live inside the row.
      surface="none"
      // The animated fade between enabled and disabled is this control's own
      // -- IconButton dims a disabled glyph instantly, and these two flip
      // constantly as rows move, so the crossfade is worth keeping.
      glyphStyle={style}
      disabled={disabled}
      onPress={onPress}
    />
  );
}
