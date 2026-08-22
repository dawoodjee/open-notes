import React, { useCallback, useRef } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import {
  Bold,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Palette,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react-native';

import { IconButton, IconButtonGroup } from './IconButton';
import { isSupported, type ToolKey } from '@/lib/notes/toolbarContext';
import { activeTextStyle } from '@/lib/notes/paragraphStyle';

/**
 * The iPad `Aa` popover — a GRID, where desktop's is a vertical list.
 *
 * `ipad-expanded-groups.jpeg` is the reference and it is a genuinely different
 * shape from `formatting-toolbar-desktop.png`:
 *
 *   row 1  paragraph styles as PILLS, scrolling horizontally, active one filled
 *   row 2  B I U S, one segmented group
 *   row 3  pen + colour · then the three list kinds
 *   row 4  outdent / indent · then block quote
 *
 * The pills are the interesting difference. A vertical list of eight rows is
 * fine under a mouse and wrong under a thumb on a device that can be 320pt wide
 * in Split View — it would be taller than the pane. Pills put the same eight
 * choices in one scrolling row, and the filled active pill says which is on
 * without a checkmark column.
 *
 * Everything it decides is shared with the desktop panel:
 * `lib/notes/paragraphStyle.ts` owns which style is active — including the fact
 * that Body is the ABSENCE of the others and has to be derived — and
 * `isSupported` owns what is dimmed. Two panels, one set of rules.
 */

const PARAGRAPH_PILLS: { key: ToolKey; label: string; className: string }[] = [
  { key: 'heading', label: 'Title', className: 'text-lg font-bold' },
  { key: 'heading2', label: 'Heading', className: 'text-base font-bold' },
  { key: 'heading3', label: 'Subheading', className: 'text-sm font-bold' },
  { key: 'body', label: 'Body', className: 'text-base' },
  { key: 'codeBlock', label: 'Monostyled', className: 'text-sm font-mono' },
];

const INLINE: { key: ToolKey; icon: React.ComponentType<any>; label: string }[] = [
  { key: 'bold', icon: Bold, label: 'Bold' },
  { key: 'italic', icon: Italic, label: 'Italic' },
  { key: 'underline', icon: Underline, label: 'Underline' },
  { key: 'strikethrough', icon: Strikethrough, label: 'Strikethrough' },
];

const MARKS: { key: ToolKey; icon: React.ComponentType<any>; label: string }[] = [
  { key: 'highlight', icon: Highlighter, label: 'Highlight' },
  { key: 'textColor', icon: Palette, label: 'Text colour' },
];

const LISTS: { key: ToolKey; icon: React.ComponentType<any>; label: string }[] = [
  { key: 'bulletList', icon: List, label: 'Bulleted list' },
  { key: 'checklist', icon: ListChecks, label: 'Checklist' },
  { key: 'numberedList', icon: ListOrdered, label: 'Numbered list' },
];

const NESTING: { key: ToolKey; icon: React.ComponentType<any>; label: string }[] = [
  { key: 'outdent', icon: IndentDecrease, label: 'Outdent' },
  { key: 'indent', icon: IndentIncrease, label: 'Indent' },
];

export interface PadStylePanelProps {
  open: boolean;
  onClose: () => void;
  active: Partial<Record<ToolKey, boolean>>;
  blocked?: Partial<Record<ToolKey, boolean>>;
  onRun: (key: ToolKey) => void;
  /** Distance from the top of the editor to the underside of the bar. */
  top: number;
}

export function PadStylePanel({ open, onClose, active, blocked, onRun, top }: PadStylePanelProps) {
  const paragraph = activeTextStyle(active);

  /**
   * Scroll the ACTIVE pill into view when the panel opens.
   *
   * Without this the row always starts at Title, and on a note in Body — the
   * common case — the highlighted pill was half off the right edge the moment
   * the panel appeared. The panel is 300pt to fit a Split View pane, the five
   * pills need about 380, so something has to scroll; what must not happen is
   * that the one thing you opened the panel to check is the thing you cannot
   * see.
   *
   * Driven by the pill's own `onLayout` rather than an index-times-width guess:
   * the labels are different lengths and grow with Dynamic Type.
   */
  const pillScroll = useRef<ScrollView>(null);
  const onActivePillLayout = useCallback((x: number) => {
    // Left-align it with a little lead-in, so the pill before it stays partly
    // visible and the row reads as scrollable rather than as a fixed set.
    pillScroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: false });
  }, []);


  // The early return sits AFTER the hooks above, not before them: hooks must
  // run in the same order on every render, and `open` changes.
  if (!open) return null;


  // TEXT style, not paragraph style: a bulleted list can be in Body or in
  // Heading, and the lists have their own group below. See activeTextStyle.
  const group = (items: typeof INLINE) => (
    <IconButtonGroup>
      {items.map(({ key, icon, label }) => (
        <IconButton
          key={key}
          icon={icon}
          label={label}
          surface="none"
          selected={active[key] === true}
          disabled={!isSupported(key) || blocked?.[key] === true}
          disabledReason={
            !isSupported(key)
              ? 'Not available in this editor yet'
              : 'Not available where the cursor is'
          }
          onPress={() => onRun(key)}
        />
      ))}
    </IconButtonGroup>
  );

  return (
    <>
      {/* Dismiss layer. The panel covers the note, so tapping the note has to
          be a way out of it. */}
      <Pressable
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}
        accessibilityLabel="Close text styles"
      />

      <View
        className="bg-card rounded-3xl"
        style={{
          position: 'absolute',
          top,
          alignSelf: 'center',
          // Wide enough for the four-across icon rows, narrow enough to sit
          // inside a Split View pane without touching either edge.
          width: 300,
          padding: 10,
          gap: 8,
          zIndex: 21,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        {/* PARAGRAPH PILLS. Horizontal scroll rather than wrapping: wrapping
            would change the panel's HEIGHT as the active style changed, which
            is a popover that moves while you are reading it. */}
        <ScrollView
          ref={pillScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}
        >
          {PARAGRAPH_PILLS.map((pill) => {
            const on = paragraph === pill.key;
            const unavailable = !isSupported(pill.key) || blocked?.[pill.key] === true;
            return (
              <Pressable
                key={pill.key}
                disabled={unavailable}
                onPress={() => onRun(pill.key)}
                className={`px-3 py-1.5 rounded-full ${on ? 'bg-lime-500' : 'bg-foreground/10'}`}
                onLayout={
                  on ? (e) => onActivePillLayout(e.nativeEvent.layout.x) : undefined
                }
                accessibilityState={{ checked: on, disabled: unavailable }}
                {...MENU_RADIO}
                aria-checked={on}
              >
                <RNText
                  className={`${pill.className} ${
                    on ? 'text-on-accent' : unavailable ? 'text-muted-foreground opacity-60' : 'text-foreground'
                  }`}
                >
                  {pill.label}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View className="bg-foreground/10 rounded-2xl px-1 py-0.5">{group(INLINE)}</View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View className="bg-foreground/10 rounded-2xl px-1 py-0.5">{group(MARKS)}</View>
          <View className="bg-foreground/10 rounded-2xl px-1 py-0.5 flex-1 items-center">
            {group(LISTS)}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View className="bg-foreground/10 rounded-2xl px-1 py-0.5">{group(NESTING)}</View>
          <View className="bg-foreground/10 rounded-2xl px-1 py-0.5 flex-1 items-center">
            {group([{ key: 'blockquote', icon: Quote, label: 'Block quote' }])}
          </View>
        </View>
      </View>
    </>
  );
}

/** Same reasoning as TextStylePanel's: the pills are mutually exclusive, which
 *  is what `menuitemradio` means and what makes `aria-checked` valid. */
const MENU_RADIO = { role: 'menuitemradio' } as unknown as { role: 'menuitem' };
