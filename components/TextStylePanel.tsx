import React from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { Bold, Check, Highlighter, Italic, Palette, Strikethrough, Underline } from 'lucide-react-native';

import { IconButton, IconButtonGroup } from './IconButton';
import { isSupported, type ToolKey } from '@/lib/notes/toolbarContext';
import { activeParagraphStyle } from '@/lib/notes/paragraphStyle';

/**
 * The desktop `Aa` popover: inline marks across the top, paragraph styles
 * below.
 *
 * ── WHY IT LIVES INSIDE THE EDITOR AND NOT IN THE BAR ─────────────────────
 *
 * Everything it needs -- which marks are active, which are blocked at the
 * caret, and the instance to run them on -- belongs to `RichEditor`. Putting
 * the panel in `DesktopTopBar` would mean lifting all of that two levels up
 * through `NoteEditorPane` so a menu could read it, and lifting state to reach
 * a menu is how state ends up in the wrong place permanently.
 *
 * So the bar owns one boolean -- is the panel open -- and the editor owns
 * everything else. The panel positions itself under the bar's centre group
 * because the bar IS centred over the editor: no measuring, no anchor ref, and
 * nothing to re-measure when the window resizes.
 *
 * ── THE ROWS ARE READ OFF THE REFERENCE ───────────────────────────────────
 *
 * `dev-docs/design/iteration-2/floating-menu/formatting-toolbar-desktop.png`:
 * B / I / U / S / highlight / colour, then Title, Heading, Subheading, Body,
 * Monostyled, three list styles, then Block Quote below a rule. Each paragraph
 * row is drawn IN the style it applies, and the active one carries a
 * checkmark -- both of which are the point of the menu, so both are here.
 */

interface StyleRow {
  key: ToolKey;
  label: string;
  /** Drawn in the style it applies, as the reference does. */
  className: string;
}

const PARAGRAPH_ROWS: StyleRow[] = [
  { key: 'heading', label: 'Title', className: 'text-2xl font-bold text-foreground' },
  { key: 'heading2', label: 'Heading', className: 'text-lg font-bold text-foreground' },
  { key: 'heading3', label: 'Subheading', className: 'text-base font-bold text-foreground' },
  { key: 'body', label: 'Body', className: 'text-base text-foreground' },
  { key: 'codeBlock', label: 'Monostyled', className: 'text-base font-mono text-foreground' },
  { key: 'bulletList', label: '•  Bulleted List', className: 'text-base text-foreground' },
  { key: 'dashedList', label: '–  Dashed List', className: 'text-base text-foreground' },
  { key: 'numberedList', label: '1.  Numbered List', className: 'text-base text-foreground' },
];

const INLINE_ROW: { key: ToolKey; icon: React.ComponentType<any>; label: string }[] = [
  { key: 'bold', icon: Bold, label: 'Bold' },
  { key: 'italic', icon: Italic, label: 'Italic' },
  { key: 'underline', icon: Underline, label: 'Underline' },
  { key: 'strikethrough', icon: Strikethrough, label: 'Strikethrough' },
  { key: 'highlight', icon: Highlighter, label: 'Highlight' },
  { key: 'textColor', icon: Palette, label: 'Text colour' },
];

/**
 * `menuitemradio`, not `menuitem`, because exactly one paragraph style is ever
 * active -- which is what a radio group means and what makes `aria-checked`
 * valid. `aria-checked` on a plain `menuitem` is invalid ARIA and, measured in
 * the browser, react-native-web simply drops it: every row reported
 * `aria-checked=null`, so a screen reader was told nothing about which style
 * was on.
 *
 * Cast because React Native's own `Role` union has no `menuitemradio` -- it
 * models the roles the mobile accessibility APIs expose. Confined to this one
 * constant rather than widening the props, the same way DesktopTopBar confines
 * its web-only `outlineStyle`.
 */
const MENU_RADIO = { role: 'menuitemradio' } as unknown as { role: 'menuitem' };

export interface TextStylePanelProps {
  open: boolean;
  onClose: () => void;
  active: Partial<Record<ToolKey, boolean>>;
  blocked?: Partial<Record<ToolKey, boolean>>;
  onRun: (key: ToolKey) => void;
  /** Distance from the top of the editor to the underside of the bar. */
  top: number;
}

export function TextStylePanel({ open, onClose, active, blocked, onRun, top }: TextStylePanelProps) {
  if (!open) return null;

  /**
   * Body is the ABSENCE of every other block style rather than a style of its
   * own, so its checkmark cannot come from `active` -- the editor has no
   * "paragraph" state to report. `activeParagraphStyle` derives it, and is
   * tested: exactly one row is ever ticked, including on a plain line.
   */
  const paragraph = activeParagraphStyle(active);
  const isChecked = (key: ToolKey) => key === paragraph;

  return (
    <>
      {/* Dismiss layer. A menu that only closes via its own trigger is a menu
          people leave open by accident, and this one covers the note. */}
      <Pressable
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}
        accessibilityLabel="Close text styles"
      />

      <View
        className="bg-card rounded-2xl"
        style={{
          position: 'absolute',
          top,
          alignSelf: 'center',
          width: 260,
          maxHeight: 420,
          zIndex: 21,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        <View className="px-2 pt-2 pb-1 border-b border-border">
          <IconButtonGroup>
            {INLINE_ROW.map(({ key, icon, label }) => (
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
        </View>

        <ScrollView contentContainerStyle={{ paddingVertical: 4 }}>
          {PARAGRAPH_ROWS.map((row) => {
            const unavailable = !isSupported(row.key) || blocked?.[row.key] === true;
            return (
              <Pressable
                key={row.key}
                disabled={unavailable}
                onPress={() => onRun(row.key)}
                className="flex-row items-center px-3 py-2 active:bg-foreground/10"
                accessibilityState={{ checked: isChecked(row.key), disabled: unavailable }}
                accessibilityHint={
                  unavailable ? 'Not available in this editor yet' : undefined
                }
                {...MENU_RADIO}
                aria-checked={isChecked(row.key)}
              >
                {/* Fixed-width slot, so every label lands on the same left edge
                    whether or not it is the ticked one. */}
                <View style={{ width: 22 }}>
                  {isChecked(row.key) ? (
                    <Check size={15} className="text-foreground" />
                  ) : null}
                </View>
                <RNText
                  className={`${row.className} ${unavailable ? 'text-muted-foreground opacity-60' : ''}`}
                >
                  {row.label}
                </RNText>
              </Pressable>
            );
          })}

          <View className="h-px bg-border my-1" />

          <Pressable
            onPress={() => onRun('blockquote')}
            className="flex-row items-center px-3 py-2 active:bg-foreground/10"
            accessibilityState={{ checked: isChecked('blockquote') }}
            {...MENU_RADIO}
            aria-checked={isChecked('blockquote')}
          >
            <View style={{ width: 22 }}>
              {isChecked('blockquote') ? <Check size={15} className="text-foreground" /> : null}
            </View>
            <RNText className="text-base text-foreground">{'┃  Block Quote'}</RNText>
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}
