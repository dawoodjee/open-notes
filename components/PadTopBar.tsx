import React from 'react';
import { View } from 'react-native';
import {
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Search,
  Share as ShareIcon,
  SquarePen,
  Type,
} from 'lucide-react-native';

import { GROUP_GAP, IconButton, IconButtonGroup, SURFACE } from './IconButton';
import { ChromeScrim } from './ChromeScrim';
import type { PaneChrome } from '@/lib/layout/paneChrome';

/**
 * The iPad editor's top bar.
 *
 * ── WHY THIS IS NOT `DesktopTopBar` ───────────────────────────────────────
 *
 * The stage plan says iPad "inherits desktop's left/centre/right grouping".
 * `ipad-collapsed-groups.jpeg` says otherwise, and the screenshot wins — the
 * standing rule for this stage. What it actually draws is:
 *
 *   left    ONE capsule: maximise, compose
 *   right   SEPARATE circles: Aa, Share, more, search
 *
 * No centre zone at all, and no inline search field: search is a circle that
 * opens the field, because an iPad in Split View can be 320pt wide and a
 * permanently-expanded field would take most of it. The desktop bar's centre
 * capsule of four formatting controls is likewise absent — on iPad the
 * formatting lives behind `Aa`, which is what "Aa pinned to the top nav bar"
 * in the plan means.
 *
 * Two components rather than one with a `variant` prop: the zones differ, the
 * grouping differs, and the search affordance differs. A shared component would
 * be a `variant` switch wrapped around two layouts that have almost nothing in
 * common but their height.
 *
 * ── COLLAPSIBLE-FIRST ─────────────────────────────────────────────────────
 *
 * The maximise control is always present, unlike desktop's, where restore only
 * appears once something is hidden. On an iPad — especially in Split View —
 * hiding the panes is the ordinary way to get room to write, not a recovery
 * from having hidden them. So it toggles, and its glyph says which way it will
 * go.
 */

/** Bar height including its padding. Callers inset their content by this. */
export const PAD_BAR_HEIGHT = SURFACE + 20;

export interface PadTopBarProps {
  chrome: PaneChrome;
  /** Hides both panes, or brings them back. */
  onToggleMaximised: () => void;
  onNewNote: () => void;
  onShare: () => void;
  onSearch: () => void;
  onTextStyles?: () => void;
  /** False when the editor behind this bar cannot format — see DesktopTopBar. */
  canFormat?: boolean;
  /**
   * Safe-area top inset. Zero on web, which is why this was missed until the
   * bar reached an iPad: there the status bar runs across the top of the screen
   * and a bar pinned to `top: 0` sits directly under it, with its controls a
   * few points clear of the clock.
   */
  topInset?: number;
  /** Rendered as the overflow trigger so the caller keeps owning the menu. */
  menuTrigger?: React.ReactNode;
}

export function PadTopBar({
  chrome,
  onToggleMaximised,
  onNewNote,
  onShare,
  onSearch,
  onTextStyles,
  canFormat = true,
  menuTrigger,
  topInset = 0,
}: PadTopBarProps) {
  // `editorShowsRestorePanes` means the list is hidden, which on iPad is the
  // maximised state. The matrix already knows this; the bar only renames it.
  const maximised = chrome.editorShowsRestorePanes;

  return (
    <View
      // `box-none` so the bar never eats a tap meant for the note underneath —
      // only its actual controls are hit-testable. See DesktopTopBar.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: PAD_BAR_HEIGHT + topInset,
        paddingTop: topInset,
        overflow: 'visible',
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 10,
      }}
    >
      <ChromeScrim height={PAD_BAR_HEIGHT + topInset} />

      {/* LEFT: one capsule, both states. Unlike desktop, its shape does not
          change — only the maximise glyph flips. */}
      <IconButtonGroup>
        <IconButton
          icon={maximised ? Minimize2 : Maximize2}
          label={maximised ? 'Show the note list' : 'Hide the panes'}
          onPress={onToggleMaximised}
        />
        <IconButton icon={SquarePen} label="New note" onPress={onNewNote} />
      </IconButtonGroup>

      <View style={{ flex: 1 }} pointerEvents="box-none" />

      {/* RIGHT: separate circles, not a capsule. The reference draws them with
          clear gaps, and they are four unrelated things — a formatting menu, an
          export, an overflow and a search — so nothing here shares a surface. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GROUP_GAP }}>
        <IconButton
          icon={Type}
          label="Text styles"
          onPress={onTextStyles}
          disabled={!canFormat}
          disabledReason="Not available in this editor yet"
        />
        <IconButton icon={ShareIcon} label="Share this note" onPress={onShare} />
        {menuTrigger ?? <IconButton icon={MoreHorizontal} label="More options" />}
        <IconButton icon={Search} label="Search notes" onPress={onSearch} />
      </View>
    </View>
  );
}
