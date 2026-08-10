import React, { useEffect, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import {
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
} from '@/components/ui/modal';
import { Pressable } from '@/components/ui/pressable';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { X, AlertTriangle } from 'lucide-react-native';
import { getPowerSync } from '@/lib/powersync/db';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSubHeader,
} from '@/components/ui/settings-group';
import { SecurityView } from '@/components/SecurityView';
import { useVault } from '@/contexts/VaultContext';

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

      <ScrollView className="flex-1 px-5 pt-4 bg-white">
        <SettingsGroup caption="Sync issues">
          {issues.length === 0 ? (
            <SettingsRow label="Everything looks good" />
          ) : (
            issues.map((issue) => (
              <HStack key={issue.id} className="items-start gap-2 px-4 py-3">
                <Icon as={AlertTriangle} className="text-amber-500 w-4 h-4 mt-0.5" />
                <RNText className="text-sm text-gray-700 flex-1">{issue.message}</RNText>
              </HStack>
            ))
          )}
        </SettingsGroup>

        {issues.length > 0 && (
          <Pressable
            onPress={handleClear}
            className="py-3.5 rounded-2xl bg-gray-100 items-center active:bg-gray-200"
          >
            <RNText className="text-sm font-medium text-gray-700">Clear</RNText>
          </Pressable>
        )}

        <View className="h-8" />
      </ScrollView>
    </>
  );
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [view, setView] = useState<'root' | 'advanced' | 'security'>('root');
  // Read here, in the normal tree, and handed down as props. Everything below
  // <Modal> is hoisted to an overlay root above <VaultProvider>, where this
  // hook would throw -- see the note on SecurityView.
  const { lockSettings, updateLockSettings } = useVault();

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
      {/* bg-white is explicit rather than inherited: gluestack's ModalContent
          styles its background from a theme token that doesn't resolve under
          NativeWind v5-preview, so the sheet rendered black behind its
          children. */}
      <ModalContent className="w-full max-w-full h-4/5 mt-auto mb-0 mx-0 rounded-t-2xl rounded-b-none border-0 pb-8 bg-white">
        {view === 'root' ? (
          <>
            <ModalHeader>
              <RNText className="text-base font-semibold text-gray-900">Settings</RNText>
              <ModalCloseButton>
                <Icon as={X} className="text-gray-400 w-5 h-5" />
              </ModalCloseButton>
            </ModalHeader>

            {/* A plain ScrollView rather than ModalBody: ModalBody is itself a
                ScrollView whose className maps to its own style, so its
                padding and gaps never reach the content container. */}
            <ScrollView className="flex-1 px-5 pt-4 bg-white">
              <SettingsGroup>
                <SettingsRow label="Security" onPress={() => setView('security')} />
                <SettingsRow label="Advanced" onPress={() => setView('advanced')} />
              </SettingsGroup>

              {/* Inert placeholders establishing the grouped-list pattern;
                  not implemented yet. */}
              <SettingsGroup caption="Appearance">
                <SettingsRow label="Theme" disabled />
                <SettingsRow label="Fonts" disabled />
              </SettingsGroup>

              <View className="h-8" />
            </ScrollView>
          </>
        ) : view === 'security' ? (
          <SecurityView
            onBack={() => setView('root')}
            lockSettings={lockSettings}
            updateLockSettings={updateLockSettings}
          />
        ) : (
          <AdvancedView onBack={() => setView('root')} />
        )}
      </ModalContent>
    </Modal>
  );
}
