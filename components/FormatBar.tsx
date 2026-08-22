import React, { useMemo } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bold,
  ChevronDown,
  Code,
  Heading1,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Menu,
  Palette,
  Quote,
  Strikethrough,
  Table,
  Underline,
} from 'lucide-react-native';

import { IconButton, SLOT, SURFACE } from './IconButton';
import { spring, SPRING_EXPAND } from '@/lib/theme/motion';
import { isSupported, toolbarOrder, type ToolKey } from '@/lib/notes/toolbarContext';

/**
 * The formatting bar, docked directly above the software keyboard.
 *
 * ── WHY IT MOVED FROM ABOVE THE CANVAS ────────────────────────────────────
 *
 * It used to sit in a row above the text. The comment there explained why:
 * "nothing here avoids the keyboard, so a toolbar underneath the text was
 * covered the moment you started typing -- unreachable exactly when it was
 * wanted." That was the right fix for a bar that could not track the keyboard.
 * This one can, so it goes where iOS puts its own in-context format selector:
 * against the top of the keyboard, under the thumb that is already typing.
 *
 * ── THE ORDER IS NOT DECIDED HERE ─────────────────────────────────────────
 *
 * `lib/notes/toolbarContext.ts` owns it, with the invariants under test. The
 * one that shapes this component: context REORDERS the bar and never adds or
 * removes anything. So this is a stable list whose sequence changes -- which is
 * what makes "swap in place, no bounce, no flash" achievable at all, because
 * reordering a fixed set is a layout change while a changing set is an
 * enter/exit animation, and those are what draw the eye.
 *
 * ── ONE CAPSULE THAT SCROLLS INSIDE ITSELF ────────────────────────────────
 *
 * Not a full-width strip. `mobile-navbar-default-aa-undo-redo.png` draws a
 * capsule inset from both screen edges with its rounded ends visible, and the
 * icons scrolling WITHIN it. Built as a full-width scroller first, and the
 * ends were clipped off the screen -- which read as a bar that had failed to
 * lay out rather than as one with more icons to the right.
 *
 * The expand affordance is pinned outside the scroller, at the capsule's right
 * end, so it never scrolls away from the thumb reaching for it.
 */

const ICONS: Record<ToolKey, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strikethrough: Strikethrough,
  heading: Heading1,
  bulletList: List,
  numberedList: ListOrdered,
  checklist: ListChecks,
  blockquote: Quote,
  code: Code,
  link: LinkIcon,
  image: ImageIcon,
  indent: IndentIncrease,
  outdent: IndentDecrease,
  highlight: Highlighter,
  textColor: Palette,
  table: Table,
};

const LABELS: Record<ToolKey, string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  heading: 'Heading',
  bulletList: 'Bulleted list',
  numberedList: 'Numbered list',
  checklist: 'Checklist',
  blockquote: 'Quote',
  code: 'Code',
  link: 'Link',
  image: 'Image',
  indent: 'Indent',
  outdent: 'Outdent',
  highlight: 'Highlight',
  textColor: 'Text colour',
  table: 'Table',
};

export interface FormatBarProps {
  /** Which tools are currently applied at the caret. */
  active: Partial<Record<ToolKey, boolean>>;
  /**
   * Which tools cannot be applied HERE, as opposed to not existing at all.
   * From the editor's `isBlocking` -- e.g. bold inside a code block.
   */
  blocked?: Partial<Record<ToolKey, boolean>>;
  onListItem: boolean;
  onBlankBodyLine: boolean;
  onRun: (key: ToolKey) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** False before the editor has reported any state at all. */
  visible: boolean;
}

export function FormatBar({
  active,
  blocked,
  onListItem,
  onBlankBodyLine,
  onRun,
  expanded,
  onToggleExpanded,
  visible,
}: FormatBarProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const order = useMemo(
    () => toolbarOrder({ onListItem, onBlankBodyLine }),
    [onListItem, onBlankBodyLine]
  );

  /**
   * Tracks the keyboard rather than guessing at its height.
   *
   * `useAnimatedKeyboard` reports the real height on both platforms and
   * animates with the system curve, so the bar rides up with the keyboard
   * instead of snapping into place after it. It also handles the dismiss,
   * which is the case a fixed offset always gets wrong.
   */
  const keyboard = useAnimatedKeyboard();

  /**
   * The bar STAYS when the keyboard goes down, sitting on the home-indicator
   * inset instead. It is the only formatting affordance on a phone now that
   * the toolbar above the canvas is gone, and dismissing the keyboard to read
   * a note should not also take away the ability to format it.
   */
  const bottomPad = useDerivedValue(() =>
    keyboard.height.value > 0 ? 0 : insets.bottom
  );

  const dock = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
    paddingBottom: bottomPad.value + 8,
  }));

  /**
   * Grows UPWARD into a taller panel, proportional rather than full-screen, so
   * the note stays partly visible behind it -- you are formatting something,
   * and losing sight of it is the failure mode.
   */
  const panelStyle = useAnimatedStyle(() => ({
    height: spring(expanded ? Math.min(screenHeight * 0.32, 280) : 0, SPRING_EXPAND),
    opacity: spring(expanded ? 1 : 0, SPRING_EXPAND),
  }));

  if (!visible) return null;

  const button = (key: ToolKey) => (
    <IconButton
      key={key}
      icon={ICONS[key]}
      label={LABELS[key]}
      // The capsule around them provides the surface, so each glyph paints
      // only its own inset -- see IconButton's `surface` prop.
      surface="none"
      selected={active[key] === true}
      disabled={!isSupported(key) || blocked?.[key] === true}
      // The two kinds of dimmed look identical and must not SOUND identical.
      disabledReason={
        !isSupported(key)
          ? 'Not available in this editor yet'
          : 'Not available where the cursor is'
      }
      onPress={() => onRun(key)}
    />
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, dock]}
    >
      {/* The expanded panel, above the bar and sharing its inset. */}
      <Animated.View
        style={[{ marginHorizontal: 12, overflow: 'hidden', borderRadius: 20 }, panelStyle]}
        className="bg-foreground/10"
      >
        <ScrollView contentContainerStyle={{ padding: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {order.map(button)}
          </View>
        </ScrollView>
      </Animated.View>

      <View
        style={{
          marginHorizontal: 12,
          marginTop: 8,
          height: SURFACE,
          borderRadius: SURFACE / 2,
          flexDirection: 'row',
          alignItems: 'center',
          overflow: 'hidden',
        }}
        className="bg-foreground/10"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // No wrapping, and a flick lands on a clean icon edge rather than
          // stopping mid-glyph. The pitch is the icon-button system's own SLOT,
          // so this bar and every other row of controls agree on it.
          snapToInterval={SLOT}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: 4, alignItems: 'center' }}
          style={{ flex: 1 }}
        >
          {order.map(button)}
        </ScrollView>

        {/* Pinned, so it never scrolls away from the thumb reaching for it.
            No background of its own: the capsule already supplies one, and a
            second bg-foreground/10 on top of it painted a visibly lighter
            patch behind this one button. */}
        <View style={{ paddingHorizontal: 2 }}>
          <IconButton
            icon={expanded ? ChevronDown : Menu}
            label={expanded ? 'Collapse formatting' : 'More formatting'}
            surface="none"
            onPress={onToggleExpanded}
          />
        </View>
      </View>
    </Animated.View>
  );
}
