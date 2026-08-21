import React, { useState } from 'react';
import { Pressable, Text as RNText, useWindowDimensions, View } from 'react-native';
import { ChevronRight, Copy, Folder as FolderIcon, Pin, PinOff, Share, Trash2 } from 'lucide-react-native';

import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';

/**
 * The note context menu -- long-press on touch, right-click on desktop.
 *
 * TWO SHAPES, and this is the one place the reference genuinely diverges by
 * platform rather than just by size. Touch gets a card with a row of labelled
 * icons across the top (Share / Move / Delete) above a short list; desktop
 * gets a plain vertical list with a `Move to` flyout and no icon row at all.
 * Compare mobile-press-and-hold-note-context-menu.png against
 * desktop-context-menu.png -- they are not the same menu at two sizes.
 *
 * WHY THE TOUCH VARIANT IS NOT A GLUESTACK `Menu`. A Menu lays its children
 * out as a vertical list of MenuItems, which is exactly what the top icon row
 * is not. Forcing three horizontal buttons into one MenuItem means fighting
 * its press handling for no gain, so the touch variant is a positioned card
 * and the desktop variant -- which really is a list -- keeps the Menu.
 *
 * Apple's menu also offers Open in New Window, Lock Note and Tags. None of the
 * three exist in this app (no iPad multi-window, no note locking, tags are
 * iteration 3), so they are absent rather than present-and-inert.
 */

export interface NoteMenuTarget {
  noteId: string;
  title: string;
  isPinned: boolean;
  anchor: { x: number; y: number };
}

export interface NoteContextMenuProps {
  target: NoteMenuTarget | null;
  /** 'touch' = phone and iPad. 'desktop' = web pointer. */
  variant: 'touch' | 'desktop';
  onClose: () => void;
  onShare: (t: NoteMenuTarget) => void;
  onMove: (t: NoteMenuTarget) => void;
  onDelete: (t: NoteMenuTarget) => void;
  onTogglePin: (t: NoteMenuTarget) => void;
  onDuplicate: (t: NoteMenuTarget) => void;
}

/** Roughly what the touch card measures. Used only until onLayout lands. */
const ESTIMATED_CARD_HEIGHT = 200;
const CARD_WIDTH = 280;

export function NoteContextMenu({
  target,
  variant,
  onClose,
  onShare,
  onMove,
  onDelete,
  onTogglePin,
  onDuplicate,
}: NoteContextMenuProps) {
  const { width, height } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(ESTIMATED_CARD_HEIGHT);

  if (!target) return null;

  // Close FIRST, then act. Acting first leaves the menu floating above the
  // sheet or dialog it just spawned -- the same trap FolderContextMenu's
  // `run` helper exists to avoid.
  const run = (fn: (t: NoteMenuTarget) => void) => () => {
    onClose();
    fn(target);
  };

  if (variant === 'desktop') {
    return (
      <Menu
        isOpen
        onClose={onClose}
        placement="bottom left"
        className="rounded-2xl p-0 overflow-hidden min-w-[240px]"
        trigger={({ ...triggerProps }) => (
          <View
            {...triggerProps}
            style={{
              position: 'absolute',
              left: target.anchor.x,
              top: target.anchor.y,
              width: 1,
              height: 1,
            }}
          />
        )}
      >
        <MenuItem
          key="pin"
          textValue="Pin Note"
          onPress={run(onTogglePin)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon
            as={target.isPinned ? PinOff : Pin}
            className="text-muted-foreground w-[18px] h-[18px]"
          />
          <MenuItemLabel className="text-base text-foreground">
            {target.isPinned ? 'Unpin Note' : 'Pin Note'}
          </MenuItemLabel>
        </MenuItem>

        <MenuItem
          key="duplicate"
          textValue="Duplicate Note"
          onPress={run(onDuplicate)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Copy} className="text-muted-foreground w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-foreground">Duplicate Note</MenuItemLabel>
        </MenuItem>

        <MenuSeparator key="sep-1" />

        <MenuItem
          key="share"
          textValue="Share Note"
          onPress={run(onShare)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Share} className="text-muted-foreground w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-foreground">Share Note</MenuItemLabel>
        </MenuItem>

        {/* The folder picker this opens is a NESTED FLYOUT on desktop, not the
            modal sheet touch gets -- see desktop-move-folder-selection.png. The
            chevron is the promise that it opens rather than acts, so it stays
            even though the flyout is the caller's to render. */}
        <MenuItem
          key="move"
          textValue="Move to"
          onPress={run(onMove)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={FolderIcon} className="text-muted-foreground w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-foreground flex-1">Move to</MenuItemLabel>
          <Icon as={ChevronRight} className="text-muted-foreground w-4 h-4" />
        </MenuItem>

        <MenuSeparator key="sep-2" />

        <MenuItem
          key="delete"
          textValue="Delete"
          onPress={run(onDelete)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Trash2} className="text-destructive w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-destructive">Delete</MenuItemLabel>
        </MenuItem>
      </Menu>
    );
  }

  // --- Touch variant -------------------------------------------------------
  //
  // Clamped into the screen on both axes, and flipped ABOVE the finger when
  // there isn't room below. Without the flip, long-pressing a row near the
  // bottom of the list puts the menu half off screen, which is where most
  // long presses happen.
  const left = Math.min(Math.max(12, target.anchor.x - CARD_WIDTH / 2), width - CARD_WIDTH - 12);
  const opensUpward = target.anchor.y + cardHeight + 24 > height;
  const top = opensUpward
    ? Math.max(12, target.anchor.y - cardHeight - 12)
    : Math.min(target.anchor.y + 12, height - cardHeight - 12);

  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      {/* Dimmed backdrop. Also the dismiss target -- a tap anywhere outside
          the card closes, which is what every iOS context menu does and what
          people try first.
          The tint is on a VIEW with the Pressable inside it, rather than a
          className straight on the Pressable: that is the idiom the rest of
          the app's overlays use (DeleteFolderDialog, PlaintextConsentDialog),
          and putting the class on the Pressable rendered no tint at all. */}
      <View
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        className="bg-black/40"
      >
        <Pressable
          onPress={onClose}
          style={{ flex: 1 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
        />
      </View>

      <View
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        style={{ position: 'absolute', left, top, width: CARD_WIDTH }}
        className="rounded-2xl bg-popover overflow-hidden"
      >
        {/* Top icon row: bare glyphs with labels beneath, NOT contained
            buttons -- see the reference. Delete is the only one tinted, which
            is what makes it read as the dangerous one without a confirm. */}
        <View className="flex-row px-2 pt-3 pb-2">
          <IconAction label="Share" icon={Share} onPress={run(onShare)} />
          <IconAction label="Move" icon={FolderIcon} onPress={run(onMove)} />
          <IconAction label="Delete" icon={Trash2} destructive onPress={run(onDelete)} />
        </View>

        <View className="h-px bg-border" />

        <ListAction
          label={target.isPinned ? 'Unpin Note' : 'Pin Note'}
          icon={target.isPinned ? PinOff : Pin}
          onPress={run(onTogglePin)}
        />
        <ListAction label="Duplicate Note" icon={Copy} onPress={run(onDuplicate)} />
      </View>
    </View>
  );
}

function IconAction({
  label,
  icon,
  destructive = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<any>;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      containerStyle={{ flex: 1 }}
      style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }}
      className="rounded-xl"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon
        as={icon}
        className={`w-6 h-6 ${destructive ? 'text-destructive' : 'text-foreground'}`}
      />
      <RNText className={`text-xs ${destructive ? 'text-destructive' : 'text-foreground'}`}>
        {label}
      </RNText>
    </PressableScale>
  );
}

function ListAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<any>;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon as={icon} className="w-[18px] h-[18px] text-foreground" />
      <RNText className="text-base text-foreground">{label}</RNText>
    </PressableScale>
  );
}
