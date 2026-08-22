import React from 'react';
import { Platform, TextInput, View } from 'react-native';
import {
  ListChecks,
  MoreHorizontal,
  Paperclip,
  PanelLeft,
  Search,
  Share as ShareIcon,
  SquarePen,
  Table,
  Type,
} from 'lucide-react-native';

import { GROUP_GAP, IconButton, IconButtonGroup, SURFACE } from './IconButton';
import { ChromeScrim } from './ChromeScrim';
import { useTheme } from '@/contexts/ThemeContext';
import type { PaneChrome } from '@/lib/layout/paneChrome';

/**
 * The desktop editor's top bar. Transparent, FLOATING OVER the note rather
 * than sitting in a row above it.
 *
 * ── LAYOUT, READ OFF THE TWO REFERENCES ───────────────────────────────────
 *
 * `desktop-top-bar-groups.png` (folders hidden, list shown) and
 * `desktop-minimize-restore-states.png` (both hidden) show the same three
 * zones, and the LEFT one changes shape between them:
 *
 *   left    compose alone           -> a circle
 *           restore + compose       -> ONE capsule
 *   centre  Aa / checklist / table / paperclip, one capsule
 *   right   Share / more, one capsule, then the search field as its own group
 *
 * That left-hand change is not decoration: it is the minimize/restore matrix
 * surfacing. Which controls exist is decided in `lib/layout/paneChrome.ts` and
 * asserted by tests, not here -- this component only draws what it is handed.
 *
 * ── WHY THE TITLE IS NOT OVERLAPPED ON A NEW NOTE ─────────────────────────
 *
 * The bar floats, so the document beneath must start below it. That is the
 * caller's job -- it owns the scroll view -- and `BAR_HEIGHT` is exported for
 * exactly that inset. Content then slides UNDER the bar as it scrolls, which
 * is the behaviour the spec asks for: no overlap at rest, overlap on scroll.
 *
 * ── FLAT, NOT GLASS ───────────────────────────────────────────────────────
 *
 * Glass is a THEME now, and an unbuilt one (Settings -> Appearance -> Theme).
 * Until it ships this bar paints flat surfaces, which is what every icon
 * button in the app already does, and the only theme-dependent thing here is
 * the shadow's tint.
 */

/** Bar height including its padding. Callers inset their content by this. */
export const BAR_HEIGHT = SURFACE + 20;

export interface DesktopTopBarProps {
  chrome: PaneChrome;
  onRestorePanes: () => void;
  onNewNote: () => void;
  onShare: () => void;
  searchQuery: string;
  onSearchChange: (next: string) => void;
  /** Rendered as the overflow trigger so the caller keeps owning the menu. */
  menuTrigger?: React.ReactNode;
  /** Formatting controls the editor can actually perform right now. */
  onTextStyles?: () => void;
  onChecklist?: () => void;
  /**
   * False when the editor behind this bar cannot format at all -- which is
   * every web session until Stage 13, since the web editor is plain text.
   *
   * The centre group then dims WHOLE, rather than being hidden or, worse, left
   * live and silently doing nothing. Same treatment Table and Attach already
   * get beside it, for the same reason: the bar's layout is final now and does
   * not shift the day the editor gains the capability.
   */
  canFormat?: boolean;
}

/** The --muted-foreground token, for the one prop that cannot take a class.
 *  Same hand-kept pairing as DeleteFolderDialog's PLACEHOLDER. */
const PLACEHOLDER = { light: 'rgb(115 115 115)', dark: 'rgb(161 161 166)' } as const;

export function DesktopTopBar({
  chrome,
  onRestorePanes,
  onNewNote,
  onShare,
  searchQuery,
  onSearchChange,
  menuTrigger,
  onTextStyles,
  onChecklist,
  canFormat = true,
}: DesktopTopBarProps) {
  const { scheme } = useTheme();

  return (
    <View
      // `box-none` so the bar itself never eats a click meant for the note
      // underneath it -- only its actual controls are hit-testable. Without
      // this a transparent full-width strip sits over the top of every
      // document and swallows the first line of text.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: BAR_HEIGHT,
        // The scrim overflows this box downward on purpose; `overflow: visible`
        // is the default but is stated because clipping it is the obvious
        // "tidy-up" that would silently remove the fade.
        overflow: 'visible',
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 10,
      }}
    >
      <ChromeScrim height={BAR_HEIGHT} />

      {/* LEFT */}
      <IconButtonGroup>
        {chrome.editorShowsRestorePanes ? (
          <IconButton
            key="restore"
            icon={PanelLeft}
            label="Show note list"
            onPress={onRestorePanes}
          />
        ) : null}
        <IconButton key="new" icon={SquarePen} label="New note" onPress={onNewNote} />
      </IconButtonGroup>

      {/* CENTRE. Flexed on both sides so it stays optically centred in the bar
          regardless of how wide the left and right groups happen to be. */}
      <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="box-none">
        <IconButtonGroup>
          <IconButton
            icon={Type}
            label="Text styles"
            onPress={onTextStyles}
            disabled={!canFormat}
            disabledReason="Not available in this editor yet"
          />
          <IconButton
            icon={ListChecks}
            label="Checklist"
            onPress={onChecklist}
            disabled={!canFormat}
            disabledReason="Not available in this editor yet"
          />
          {/* Rendered, dimmed, in their real positions. The editor cannot do
              either yet, and hiding them would mean the bar's layout shifts
              the day it can -- see the Decisions Log. */}
          <IconButton
            icon={Table}
            label="Table"
            disabled
            disabledReason="Not available in this editor yet"
          />
          <IconButton
            icon={Paperclip}
            label="Attach"
            disabled
            disabledReason="Not available in this editor yet"
          />
        </IconButtonGroup>
      </View>

      {/* RIGHT: two groups, not one -- Share/more act on the note, search acts
          on the library. The reference draws them as separate surfaces. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GROUP_GAP }}>
        <IconButtonGroup>
          <IconButton icon={ShareIcon} label="Share this note" onPress={onShare} />
          {menuTrigger ?? <IconButton icon={MoreHorizontal} label="More options" />}
        </IconButtonGroup>

        {/* Restored here, not rebuilt: Stage 11 removed the search field from
            the list pane on the understanding that this bar would carry it. */}
        <View
          className="bg-foreground/10"
          style={{
            height: SURFACE,
            borderRadius: SURFACE / 2,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            gap: 6,
            minWidth: 200,
          }}
        >
          <Search size={16} color={PLACEHOLDER[scheme]} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder="Search"
            placeholderTextColor={PLACEHOLDER[scheme]}
            className="text-sm text-foreground"
            // `outlineStyle` is a web-only CSS property RN's types do not
            // model, and the cast is confined to this one prop rather than
            // widening the whole style object. Without it the browser draws its
            // own focus ring INSIDE the capsule, which reads as a second border.
            style={[{ flex: 1 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
            accessibilityLabel="Search notes"
          />
        </View>
      </View>
    </View>
  );
}
