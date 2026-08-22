import React, { useRef } from 'react';
import { Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, ChevronUp, Pencil, Search } from 'lucide-react-native';

import { IconButton, IconButtonGroup, SURFACE } from './IconButton';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Find, and Find & Replace, inside one note.
 *
 * ── THE BOTTOM-OF-THE-SCREEN PROBLEM, DECIDED ─────────────────────────────
 *
 * On a phone three things want the bottom of the screen: the keyboard, the
 * formatting bar and this. The stage plan said that had to be decided rather
 * than discovered, so: **the formatting bar hides while find is open.** You are
 * searching, not formatting, and they are never both wanted at once. That is
 * also what iOS does with its own find bar, and it means neither has to shrink
 * to make room for the other.
 *
 * This bar then takes the formatting bar's place, riding the keyboard the same
 * way — `useAnimatedKeyboard`, same as FormatBar, so the two are
 * interchangeable rather than merely similar.
 *
 * ── TWO LAYOUTS, AND WHY THEY ARE ONE COMPONENT ───────────────────────────
 *
 * Unlike the top bars, the phone and desktop find bars are the SAME controls in
 * the same order — find field, prev/next, replace field, replace, done. Only
 * the arrangement differs: `find-and-replace-in-note-desktop.png` puts them in
 * two full-width rows docked under the top bar, and
 * `mobile-find-and-replace-in-note.png` stacks the same two rows above the
 * keyboard with the done control as an accent circle at the left. Sharing is
 * right here for the reason splitting was right there: the parts are the same.
 */

export interface FindBarProps {
  visible: boolean;
  query: string;
  onQueryChange: (next: string) => void;
  replacement: string;
  onReplacementChange: (next: string) => void;
  /** Whether the replace row is showing. */
  replaceOpen: boolean;
  onToggleReplace: () => void;
  matchCount: number;
  /** Zero-based, or -1 for none. */
  currentMatch: number;
  onStep: (direction: 1 | -1) => void;
  /** Return key in the Find field: reveal the current match. */
  onSubmit: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  /** 'docked' rides the keyboard on a phone; 'inline' sits under the top bar. */
  layout: 'docked' | 'inline';
  /** Inline only: how far down the top bar pushes this. */
  top?: number;
}

/** The --muted-foreground token, for the props that cannot take a class. */
const PLACEHOLDER = { light: 'rgb(115 115 115)', dark: 'rgb(161 161 166)' } as const;

export function FindBar(props: FindBarProps) {
  const {
    visible,
    query,
    onQueryChange,
    replacement,
    onReplacementChange,
    replaceOpen,
    onToggleReplace,
    matchCount,
    currentMatch,
    onStep,
    onSubmit,
    onReplaceOne,
    onReplaceAll,
    onClose,
    layout,
    top = 0,
  } = props;

  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const findRef = useRef<TextInput>(null);

  const dock = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
    paddingBottom: (keyboard.height.value > 0 ? 0 : insets.bottom) + 8,
  }));

  if (!visible) return null;

  /**
   * "3 of 7" while stepping, a bare count when nothing is current.
   *
   * The bare count is not a nicety — after a Replace there IS no current match
   * (every offset after the edit moved, so the index is reset), and rendering
   * `currentMatch + 1` regardless printed **"0 of 3"**, which reads as a
   * counter that has broken rather than as a search waiting to be stepped.
   * Caught on the phone.
   *
   * An empty query shows nothing at all rather than "No results": you have not
   * searched for anything yet, and telling someone their empty search failed is
   * the kind of copy that makes an app feel like it is arguing with you.
   */
  const status =
    query === ''
      ? ''
      : matchCount === 0
        ? 'No results'
        : currentMatch < 0
          ? `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`
          : `${currentMatch + 1} of ${matchCount}`;

  const field = (
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    icon: React.ReactNode,
    ref?: React.RefObject<TextInput | null>,
    onSubmitEditing?: () => void
  ) => (
    <View
      className="bg-foreground/10 flex-1"
      style={{
        height: SURFACE,
        borderRadius: SURFACE / 2,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        gap: 6,
      }}
    >
      {icon}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={PLACEHOLDER[scheme]}
        className="text-sm text-foreground"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
        // The field keeps focus across a submit, so you can type, jump, adjust
        // the query and jump again without reaching for it each time.
        submitBehavior="submit"
        returnKeyType="search"
        // Web draws its own focus ring inside the capsule, which reads as a
        // second border. Confined to this one prop -- see DesktopTopBar.
        style={[{ flex: 1 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
      />
    </View>
  );

  const steppers = (
    <IconButtonGroup>
      <IconButton
        icon={ChevronUp}
        label="Previous match"
        disabled={matchCount === 0}
        disabledReason="Nothing to step through yet"
        onPress={() => onStep(-1)}
      />
      <IconButton
        icon={ChevronDown}
        label="Next match"
        disabled={matchCount === 0}
        disabledReason="Nothing to step through yet"
        onPress={() => onStep(1)}
      />
    </IconButtonGroup>
  );

  const replaceRow = replaceOpen ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {layout === 'docked' ? (
        // The accent circle the reference puts at the left of the second row.
        // It is Done, and it is the only accent thing here -- searching has one
        // way out and this is it.
        <IconButton icon={Check} label="Done searching" variant="accent" onPress={onClose} />
      ) : null}

      {field(
        replacement,
        onReplacementChange,
        'Replace',
        <Pencil size={15} color={PLACEHOLDER[scheme]} />
      )}

      <Pressable
        onPress={onReplaceOne}
        disabled={matchCount === 0}
        className="px-3 rounded-full bg-foreground/10 items-center justify-center active:bg-foreground/20 disabled:opacity-50"
        style={{ height: SURFACE }}
        accessibilityRole="button"
        accessibilityLabel="Replace this match"
      >
        <RNText className="text-sm text-foreground">Replace</RNText>
      </Pressable>

      {layout === 'inline' ? (
        <>
          <Pressable
            onPress={onReplaceAll}
            disabled={matchCount === 0}
            className="px-3 rounded-full bg-foreground/10 items-center justify-center active:bg-foreground/20 disabled:opacity-50"
            style={{ height: SURFACE }}
            accessibilityRole="button"
            accessibilityLabel="Replace every match"
          >
            <RNText className="text-sm text-foreground">All</RNText>
          </Pressable>
          <Pressable
            onPress={onClose}
            className="px-3 rounded-full items-center justify-center active:bg-foreground/10"
            style={{ height: SURFACE }}
            accessibilityRole="button"
            accessibilityLabel="Done searching"
          >
            <RNText className="text-sm font-medium text-foreground">Done</RNText>
          </Pressable>
        </>
      ) : null}
    </View>
  ) : null;

  const findRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {field(
        query,
        onQueryChange,
        'Find',
        <Search size={15} color={PLACEHOLDER[scheme]} />,
        findRef,
        onSubmit
      )}

      {status ? (
        <RNText className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">
          {status}
        </RNText>
      ) : null}

      {steppers}

      {/* The replace toggle. On desktop the reference draws it as a labelled
          checkbox; here it is the same pencil the replace field carries, so the
          two read as one feature rather than as two unrelated controls. */}
      <IconButton
        icon={Pencil}
        label="Replace"
        selected={replaceOpen}
        onPress={onToggleReplace}
      />

      {/* Docked layout has no Done on this row -- it is the accent circle on the
          replace row, and when replace is closed the row below is just it. */}
      {layout === 'inline' && !replaceOpen ? (
        <Pressable
          onPress={onClose}
          className="px-3 rounded-full items-center justify-center active:bg-foreground/10"
          style={{ height: SURFACE }}
          accessibilityRole="button"
          accessibilityLabel="Done searching"
        >
          <RNText className="text-sm font-medium text-foreground">Done</RNText>
        </Pressable>
      ) : null}
    </View>
  );

  const rows = (
    <View style={{ gap: 8 }}>
      {findRow}
      {replaceRow ?? (layout === 'docked' ? (
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon={Check} label="Done searching" variant="accent" onPress={onClose} />
        </View>
      ) : null)}
    </View>
  );

  if (layout === 'inline') {
    return (
      <View
        className="bg-background border-b border-border"
        style={{
          position: 'absolute',
          top,
          left: 0,
          right: 0,
          paddingHorizontal: 12,
          paddingVertical: 8,
          zIndex: 15,
        }}
      >
        {rows}
      </View>
    );
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, zIndex: 15 },
        dock,
      ]}
    >
      {rows}
    </Animated.View>
  );
}
