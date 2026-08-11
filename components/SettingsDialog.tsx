import React, { useEffect, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import {
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalCloseButton,
} from '@/components/ui/modal';
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
  // Read here, in the normal tree, and handed down as props. Everything below
  // <Modal> is hoisted to an overlay root above the providers, where these
  // hooks would throw -- see the note on SecurityView.
  const { lockSettings, updateLockSettings } = useVault();
  const { preference, setPreference } = useTheme();

  const handleClose = () => {
    setView('root');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="full">
      <ModalBackdrop />
      {/* Full-bleed sheet, matching ManageAccountDialog: full width, anchored
          to the bottom, 4/5 tall, square bottom corners so it reads as
          attached to the screen rather than floating. */}
      {/* bg-background is explicit rather than inherited: gluestack's ModalContent
          styles its background from a theme token that doesn't resolve under
          NativeWind v5-preview, so the sheet rendered black behind its
          children. */}
      <ModalContent className="w-full max-w-full h-4/5 mt-auto mb-0 mx-0 rounded-t-2xl rounded-b-none border-0 pb-8 bg-background">
        {view === 'root' ? (
          <>
            <SettingsHeader
              title="Settings"
              icon={SettingsIcon}
              right={
                <ModalCloseButton>
                  <Icon as={X} className="text-muted-foreground w-5 h-5" />
                </ModalCloseButton>
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
          />
        ) : (
          <AdvancedView onBack={() => setView('root')} />
        )}
      </ModalContent>
    </Modal>
  );
}
