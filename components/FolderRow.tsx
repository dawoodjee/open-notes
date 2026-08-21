import React, { useCallback } from 'react';
import { Text as RNText, View, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';
import { ChevronRight, ChevronUp, ChevronDown, Folder as FolderIcon, Trash2, Notebook, Cog } from 'lucide-react-native';
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

  const GlyphFor = { all: Notebook, trash: Trash2, skills: Cog, user: FolderIcon }[variant];
  const iconSize = iconSizeForDepth(depth);

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
        {...webContextMenu}
      >
        <Icon
          as={GlyphFor}
          style={{ width: iconSize, height: iconSize }}
          className={isSelected ? 'text-on-accent' : 'text-lime-600 dark:text-lime-400'}
        />

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

      {isEditing ? (
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
        <Pressable
          onPress={onToggleExpanded}
          hitSlop={8}
          style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
        >
          <Animated.View style={chevronStyle}>
            <Icon as={ChevronRight} className="w-4 h-4 text-muted-foreground" />
          </Animated.View>
        </Pressable>
      ) : (
        // Keeps every row's content on the same vertical line whether or not
        // it has a chevron. Without it, leaf rows' counts sit 44px further
        // right than their siblings'.
        <View style={{ width: 44 }} />
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
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={4}
      style={{ minHeight: 44, minWidth: 36, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Animated.View style={style}>
        <Icon
          as={direction === -1 ? ChevronUp : ChevronDown}
          className="w-5 h-5 text-foreground"
        />
      </Animated.View>
    </Pressable>
  );
}
