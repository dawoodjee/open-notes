import React, { useState } from 'react';
import { IconButton, SURFACE } from './IconButton';
import { Text as RNText } from 'react-native';
import { useRouter } from 'expo-router';

import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';
import { Settings, CircleUserRound, MoreHorizontal, CircleCheck } from 'lucide-react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/lib/auth/useProfile';
import { getInitials } from '@/lib/auth/initials';
import SettingsDialog from './SettingsDialog';
import ManageAccountDialog from './ManageAccountDialog';

export interface AvatarMenuTriggerProps {
  // Layout/visibility only (e.g. "md:hidden") -- combined with, not a
  // replacement for, the auth-state-dependent circle styling below.
  className?: string;
  /**
   * How the trigger draws itself. The MENU is identical either way -- only the
   * button changes -- which is the whole reason this is a variant rather than a
   * second component: two copies of an account menu is how the two end up
   * offering different things.
   *
   *   'avatar'    initials in a circle. Phones, where it is the one piece of
   *               account chrome on screen.
   *   'overflow'  a (...) glyph. Wide layouts, where this control sits at the
   *               end of the list header and will grow list actions in Stage 11.
   */
  variant?: 'avatar' | 'overflow';
  /**
   * Enter multi-select mode. Supplied by the note list only -- the editor
   * pane renders the same menu and has nothing to select, so the item is
   * absent there rather than present and inert.
   */
  onSelectNotes?: () => void;
}

// Single entry point for both Settings and account/sync state -- rendered in
// both NoteListPane (mobile) and NoteEditorPane (desktop), replacing what
// were two independent dead "AD" placeholders. Always opens the same menu
// shape regardless of auth state; only the Identity row's label/content
// forks on whether session is set.
export default function AvatarMenuTrigger({
  className,
  variant = 'avatar',
  onSelectNotes,
}: AvatarMenuTriggerProps) {
  const router = useRouter();
  const { session } = useAuth();
  const { profile } = useProfile();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isManageAccountOpen, setIsManageAccountOpen] = useState(false);

  const isLoggedIn = !!session;
  const initials = isLoggedIn ? getInitials(session, profile?.full_name) : '';

  return (
    <>
      <Menu
        placement="bottom right"
        offset={8}
        // Same grouped-card shape as the note menu and the settings sheet --
        // see the note on UIComponentsMenu in NoteEditorPane.
        className="rounded-2xl p-0 overflow-hidden min-w-[220px]"
        trigger={({ ...triggerProps }) =>
          variant === 'overflow' ? (
            <IconButton {...triggerProps} icon={MoreHorizontal} label="More options" />
          ) : (
            <Pressable
              {...triggerProps}
              // DELIBERATELY NOT an IconButton. This branch is an AVATAR: it
              // carries identity (initials, a logged-in tint and a rim) rather
              // than naming an action, and the icon-button system's rest/hover/
              // press backgrounds would fight its own fill. What it does take
              // from the system is SURFACE, so it sits on the same optical line
              // as the real icon buttons beside it -- it used to be 32pt while
              // they were 44, and now everything on that row is 36.
              style={{ width: SURFACE, height: SURFACE }}
              className={`rounded-full items-center justify-center border ${
                isLoggedIn ? 'bg-lime-100 border-lime-300' : 'bg-transparent border-border'
              } ${className ?? ''}`}
            >
              {isLoggedIn ? (
                // allowFontScaling={false} on purpose, and it is the narrow
                // exception rather than the rule. The circle is a fixed 32pt
                // sitting in a fixed-height header row beside the back button,
                // so it cannot grow; at accessibility text sizes the initials
                // scaled past its edge and spilled over the rim. The other
                // branch of this very control is an ICON at a fixed w-5 h-5 --
                // this is the same element wearing letters instead of a glyph,
                // so the two branches should behave the same way. No content is
                // lost: the initials are an identity marker, and the account
                // name itself is one tap away in the menu this opens, at full
                // scale.
                <RNText allowFontScaling={false} className="text-xs font-bold text-lime-800">
                  {initials}
                </RNText>
              ) : (
                <Icon as={CircleUserRound} className="text-muted-foreground w-5 h-5" />
              )}
            </Pressable>
          )
        }
      >
        {/* Stage 11's list actions land above the separator, in the seam Stage
            9 left for them. Sort and Group By Date are not here: Group By Date
            already lives on the folder's own context menu, and adding a second
            control for one setting is how the two end up disagreeing. */}
        {onSelectNotes ? (
          <MenuItem
            key="select-notes"
            textValue="Select Notes"
            onPress={onSelectNotes}
            className="px-4 py-3 flex-row items-center gap-3"
          >
            <Icon as={CircleCheck} className="text-muted-foreground w-[18px] h-[18px]" />
            <MenuItemLabel className="text-base text-foreground">Select Notes</MenuItemLabel>
          </MenuItem>
        ) : null}

        {onSelectNotes ? <MenuSeparator key="sep-select" /> : null}

        <MenuItem
          key="settings"
          textValue="Settings"
          onPress={() => setIsSettingsOpen(true)}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon as={Settings} className="text-muted-foreground w-[18px] h-[18px]" />
          <MenuItemLabel className="text-base text-foreground">Settings</MenuItemLabel>
        </MenuItem>

        <MenuSeparator />

        <MenuItem
          key="identity"
          textValue={isLoggedIn ? 'Manage Account' : 'Sync'}
          onPress={() => {
            if (isLoggedIn) {
              setIsManageAccountOpen(true);
            } else {
              router.push('/enable-sync');
            }
          }}
          className="px-4 py-3 flex-row items-center gap-3"
        >
          <Icon
            as={CircleUserRound}
            className={`w-[18px] h-[18px] ${isLoggedIn ? "text-muted-foreground" : "text-pink-600"}`}
          />
          <MenuItemLabel
            className={`text-base ${isLoggedIn ? "text-foreground" : "text-pink-600"}`}
          >
            {isLoggedIn ? 'Manage Account' : 'Sync'}
          </MenuItemLabel>
        </MenuItem>
      </Menu>

      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      {isLoggedIn && (
        <ManageAccountDialog
          isOpen={isManageAccountOpen}
          onClose={() => setIsManageAccountOpen(false)}
        />
      )}
    </>
  );
}
