import React, { useEffect, useState } from 'react';
import { ScrollView, Text as RNText } from 'react-native';
import {
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
} from '@/components/ui/modal';
import { Pressable } from '@/components/ui/pressable';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import {
  X,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Palette,
  Sun,
  Type,
  Wrench,
  AlertTriangle,
} from 'lucide-react-native';
import { getPowerSync } from '@/lib/powersync/db';

export interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SettingsRowProps {
  icon: React.ComponentType<any>;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}

function SettingsRow({ icon, label, onPress, disabled }: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100 active:bg-gray-50"
    >
      <HStack className="items-center gap-3">
        <Icon as={icon} className={`w-5 h-5 ${disabled ? 'text-gray-300' : 'text-gray-600'}`} />
        <RNText className={`text-base ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
          {label}
        </RNText>
      </HStack>
      {onPress && <Icon as={ChevronRight} className="text-gray-300 w-4 h-4" />}
    </Pressable>
  );
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
      <HStack className="items-center px-5 py-4 border-b border-gray-100">
        <Pressable onPress={onBack} className="p-1 -ml-1 mr-2">
          <Icon as={ChevronLeft} className="text-gray-600 w-5 h-5" />
        </Pressable>
        <RNText className="text-base font-semibold text-gray-900">Advanced</RNText>
      </HStack>

      <ScrollView className="flex-1 px-5 py-5">
        <RNText className="text-xs font-semibold text-gray-400 uppercase mb-2">
          Sync Issues
        </RNText>

        {issues.length === 0 ? (
          <RNText className="text-sm text-gray-500 py-2">Everything looks good.</RNText>
        ) : (
          <>
            {issues.map((issue) => (
              <HStack key={issue.id} className="items-start gap-2 py-2 border-b border-gray-50">
                <Icon as={AlertTriangle} className="text-amber-500 w-4 h-4 mt-0.5" />
                <RNText className="text-sm text-gray-700 flex-1">{issue.message}</RNText>
              </HStack>
            ))}
            <Pressable
              onPress={handleClear}
              className="mt-6 py-3.5 rounded-2xl bg-gray-100 items-center active:bg-gray-200"
            >
              <RNText className="text-sm font-medium text-gray-700">Clear</RNText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </>
  );
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [view, setView] = useState<'root' | 'advanced'>('root');

  const handleClose = () => {
    setView('root');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="full">
      <ModalBackdrop />
      <ModalContent className="w-full max-w-full h-4/5 mt-auto mb-0 mx-0 rounded-t-2xl rounded-b-none border-0 pb-8">
        {view === 'root' ? (
          <>
            <ModalHeader>
              <RNText className="text-base font-semibold text-gray-900">Settings</RNText>
              <ModalCloseButton>
                <Icon as={X} className="text-gray-400 w-5 h-5" />
              </ModalCloseButton>
            </ModalHeader>
            <ScrollView className="flex-1">
              <ModalBody className="p-0">
                {/* Change PIN is a stub -- Stage 6 wires the real action. */}
                <SettingsRow icon={KeyRound} label="Change PIN" onPress={() => {}} />
                {/* Appearance/Theme/Fonts are inert placeholders establishing
                    the scrollable-dialog pattern now, not implemented yet. */}
                <SettingsRow icon={Palette} label="Appearance" disabled />
                <SettingsRow icon={Sun} label="Theme" disabled />
                <SettingsRow icon={Type} label="Fonts" disabled />
                <SettingsRow icon={Wrench} label="Advanced" onPress={() => setView('advanced')} />
              </ModalBody>
            </ScrollView>
          </>
        ) : (
          <AdvancedView onBack={() => setView('root')} />
        )}
      </ModalContent>
    </Modal>
  );
}
