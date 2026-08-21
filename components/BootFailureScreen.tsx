import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { BACKGROUND, ON_ACCENT, useTheme } from '@/contexts/ThemeContext';

/**
 * What the app shows when the vault or the database refuses to open.
 *
 * This screen exists because its absence was itself the bug. A rejection in
 * VaultContext's boot left `status` at 'loading' forever, and 'loading'
 * rendered an empty white View -- so a recoverable database problem was
 * indistinguishable from a crashed app, a hung Metro connection, or a dead
 * simulator. Nothing on screen, nothing to report, nothing to try.
 *
 * Two deliberate choices:
 *
 *   The raw error is shown, behind a disclosure. Not a friendly paraphrase --
 *   the paraphrase is the part that loses the information you actually need,
 *   and this is a notes app being debugged by the person who wrote it.
 *
 *   Reset is destructive and says so plainly, without softening. Notes that
 *   belong to an account come back on the next sync; notes written before
 *   signing in exist nowhere else and will not.
 */
export function BootFailureScreen({
  error,
  onReset,
}: {
  error: string | null;
  onReset: () => Promise<void>;
}) {
  const { scheme } = useTheme();
  const [showDetail, setShowDetail] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND[scheme] }}>
      <ScrollView className="flex-1 px-6 pt-10">
        <View className="flex-row items-center mb-4">
          <Icon as={AlertTriangle} className="text-amber-500 w-6 h-6 mr-2" />
          <RNText className="text-xl font-bold text-foreground">Notes couldn’t start</RNText>
        </View>

        <RNText className="text-sm text-muted-foreground leading-5 mb-6">
          The local database didn’t open. Your notes are still encrypted and the server still
          can’t read them — this is a problem with the copy on this device.
        </RNText>

        <Pressable
          onPress={() => setShowDetail((v) => !v)}
          className="flex-row items-center py-2 active:opacity-60"
        >
          <Icon
            as={showDetail ? ChevronDown : ChevronRight}
            className="text-muted-foreground w-4 h-4 mr-1"
          />
          <RNText className="text-sm text-muted-foreground">Technical details</RNText>
        </Pressable>

        {showDetail ? (
          <View className="bg-secondary rounded-xl p-3 mb-6">
            <RNText className="text-xs text-muted-foreground font-mono leading-4">
              {error ?? 'No error message was captured.'}
            </RNText>
          </View>
        ) : (
          <View className="h-4" />
        )}

        {confirming ? (
          <View className="bg-red-50 dark:bg-red-950/40 rounded-2xl p-4 mb-4">
            <RNText className="text-sm text-red-700 dark:text-red-300 leading-5 mb-4">
              This deletes every note stored on this device. Notes synced to your account will
              come back when you sign in. Notes written before you signed in will not.
            </RNText>
            <Pressable
              onPress={handleReset}
              disabled={resetting}
              className="py-3 rounded-xl bg-red-500 items-center active:bg-red-600 disabled:opacity-50"
            >
              {resetting ? (
                <ActivityIndicator color={ON_ACCENT} />
              ) : (
                <RNText className="text-sm font-semibold text-on-accent">
                  Delete local data and restart
                </RNText>
              )}
            </Pressable>
            <Pressable onPress={() => setConfirming(false)} className="items-center py-3">
              <RNText className="text-sm text-muted-foreground">Cancel</RNText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setConfirming(true)}
            className="py-3.5 rounded-2xl bg-muted items-center active:bg-accent"
          >
            <RNText className="text-sm font-medium text-foreground">Reset this device</RNText>
          </Pressable>
        )}

        <View className="h-10" />
      </ScrollView>
    </SafeAreaView>
  );
}
