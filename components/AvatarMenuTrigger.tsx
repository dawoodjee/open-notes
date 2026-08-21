import React, { useState } from 'react';
import { Text as RNText } from 'react-native';
import { useRouter } from 'expo-router';

import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '@/components/ui/menu';
import { Settings, CircleUserRound, MoreHorizontal } from 'lucide-react-native';

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
}

// Single entry point for both Settings and account/sync state -- rendered in
// both NoteListPane (mobile) and NoteEditorPane (desktop), replacing what
// were two independent dead "AD" placeholders. Always opens the same menu
// shape regardless of auth state; only the Identity row's label/content
// forks on whether session is set.
export default function AvatarMenuTrigger({
  className,
  variant = 'avatar',
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
            <Pressable
              {...triggerProps}
              hitSlop={8}
              style={{
                minHeight: 44,
                minWidth: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              className={className ?? ''}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Icon as={MoreHorizontal} className="text-foreground w-6 h-6" />
            </Pressable>
          ) : (
            <Pressable
              {...triggerProps}
              className={`w-8 h-8 rounded-full items-center justify-center border ${
                isLoggedIn ? 'bg-lime-100 border-lime-300' : 'bg-transparent border-border'
              } ${className ?? ''}`}
            >
              {isLoggedIn ? (
                <RNText className="text-xs font-bold text-lime-800">{initials}</RNText>
              ) : (
                <Icon as={CircleUserRound} className="text-muted-foreground w-5 h-5" />
              )}
            </Pressable>
          )
        }
      >
        {/* Stage 11's list actions -- Select, Sort, Group By Date -- land above
            this separator, which is why the account items are grouped below it
            rather than sitting at the top of the menu. Leaving the seam here
            now means Stage 11 adds items rather than rearranging them. */}
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
