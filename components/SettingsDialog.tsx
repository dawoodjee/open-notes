import React, { useEffect, useState } from 'react';
import { IconButton } from './IconButton';
import { ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import { ModalBottomSheet } from '@swmansion/react-native-bottom-sheet';
import { Pressable } from '@/components/ui/pressable';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import {
  X,
  AlertTriangle,
  Settings as SettingsIcon,
  ShieldCheck,
  Wrench,
  Palette,
  Type,
} from 'lucide-react-native';
import { getPowerSync } from '@/lib/powersync/db';
import {
  SettingsGroup,
  SettingsHeader,
  SettingsRow,
  SettingsSubHeader,
} from '@/components/ui/settings-group';
import { SecurityView } from '@/components/SecurityView';
import { EndpointsView } from '@/components/EndpointsView';
import { AppearanceView } from '@/components/AppearanceView';
import { useVault } from '@/contexts/VaultContext';
import { useTheme } from '@/contexts/ThemeContext';

export interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SyncIssueRow {
  id: string;
  note_id: string;
  message: string;
  occurred_at: string;
}

function AdvancedView({ onBack }: { onBack: () => void }) {
  const [issues, setIssues] = useState<SyncIssueRow[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    getPowerSync().watch(
      'SELECT id, note_id, message, occurred_at FROM sync_issues ORDER BY occurred_at DESC',
      [],
      {
        onResult: (result) => setIssues(result.array as unknown as SyncIssueRow[]),
        onError: (err) => console.error('sync_issues watch error:', err),
      },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, []);

  const handleClear = async () => {
    await getPowerSync().execute('DELETE FROM sync_issues');
  };

  return (
    <>
      <SettingsSubHeader title="Advanced" onBack={onBack} />

      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        <SettingsGroup caption="Sync issues">
          {issues.length === 0 ? (
            <SettingsRow label="Everything looks good" />
          ) : (
            issues.map((issue) => (
              <HStack key={issue.id} className="items-start gap-2 px-4 py-3">
                <Icon as={AlertTriangle} className="text-amber-500 w-4 h-4 mt-0.5" />
                <RNText className="text-sm text-foreground flex-1">{issue.message}</RNText>
              </HStack>
            ))
          )}
        </SettingsGroup>

        {issues.length > 0 && (
          <Pressable
            onPress={handleClear}
            className="py-3.5 rounded-2xl bg-muted items-center active:bg-muted"
          >
            <RNText className="text-sm font-medium text-foreground">Clear</RNText>
          </Pressable>
        )}

        <View className="h-8" />
      </ScrollView>
    </>
  );
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [view, setView] = useState<
    'root' | 'advanced' | 'security' | 'endpoints' | 'appearance'
  >('root');
  /**
   * Read here and handed down as props.
   *
   * This USED to be mandatory: the Gluestack `Modal` hoisted everything below
   * it to an overlay root above the providers, so these hooks threw inside.
   * On the native sheet (12.5) they no longer would — it renders inline and
   * reparents natively. The props are kept anyway, because the sub-views are
   * now testable without a provider and because rewiring five screens to prove
   * a point is not what this stage is for. New sheets can read context
   * directly.
   */
  const { lockSettings, updateLockSettings } = useVault();
  const { preference, setPreference, bulletStyle, setBulletStyle, theme, setTheme } = useTheme();

  // Four fifths of the WINDOW, in points. See the detent note below.
  const sheetHeight = useWindowDimensions().height * 0.8;

  const handleClose = () => {
    setView('root');
    onClose();
  };

  return (
    <ModalBottomSheet
      // See FolderPickerSheet's header for what the native sheet retires: the
      // black-background token, the unusable ModalBody, and the provider hoist.
      nativeOverlay
      // The Gluestack version had `<ModalBackdrop />`; the native sheet has no
      // scrim unless one is named, and without it the sheet is invisible
      // against the app -- both are `bg-background`, so the only thing that
      // separated them was the dimming. Found on the phone: the picker
      // presented at the right height and looked like the screen had simply
      // rearranged itself.
      scrimColor="rgba(0,0,0,0.4)"
      // Points, not a fraction -- see FolderPickerSheet for the sub-pixel trap.
      // Not 'content': Settings' height changes as you push into sub-views, and
      // a sheet that resizes under your thumb as you navigate is worse than one
      // that does not fit its shortest screen.
      detents={[0, sheetHeight]}
      index={isOpen ? 1 : 0}
      onSettle={(index) => {
        if (index === 0 && isOpen) handleClose();
      }}
      surface={<View className="flex-1 bg-background rounded-t-2xl" />}
    >
      <View className="flex-1 pb-8">
        {view === 'root' ? (
          <>
            <SettingsHeader
              title="Settings"
              icon={SettingsIcon}
              right={
                // Not ModalCloseButton: that closes through the modal's own
                // context and would skip handleClose, leaving the settings view
                // parked on a sub-screen the next time it opens. Same reasoning
                // as the X in ManageAccountDialog.
                <IconButton icon={X} label="Close" onPress={handleClose} />
              }
            />

            {/* A plain ScrollView rather than ModalBody: ModalBody is itself a
                ScrollView whose className maps to its own style, so its
                padding and gaps never reach the content container. */}
            <ScrollView className="flex-1 px-5 pt-4 bg-background">
              <SettingsGroup>
                <SettingsRow
                  icon={Palette}
                  label="Appearance"
                  onPress={() => setView('appearance')}
                />
                <SettingsRow
                  icon={ShieldCheck}
                  label="Security"
                  onPress={() => setView('security')}
                />
                <SettingsRow icon={Wrench} label="Advanced" onPress={() => setView('advanced')} />
              </SettingsGroup>

              <View className="h-8" />
            </ScrollView>
          </>
        ) : view === 'security' ? (
          <SecurityView
            onBack={() => setView('root')}
            lockSettings={lockSettings}
            updateLockSettings={updateLockSettings}
            onManageEndpoints={() => setView('endpoints')}
          />
        ) : view === 'endpoints' ? (
          <EndpointsView onBack={() => setView('security')} />
        ) : view === 'appearance' ? (
          <AppearanceView
            onBack={() => setView('root')}
            preference={preference}
            setPreference={setPreference}
            bulletStyle={bulletStyle}
            theme={theme}
            setTheme={setTheme}
            setBulletStyle={setBulletStyle}
          />
        ) : (
          <AdvancedView onBack={() => setView('root')} />
        )}
      </View>
    </ModalBottomSheet>
  );
}
