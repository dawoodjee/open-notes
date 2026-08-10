import { LogBox, View } from 'react-native';
import { Stack } from 'expo-router';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { AuthProvider } from '@/contexts/AuthContext';
import { VaultProvider, useVault } from '@/contexts/VaultContext';
import { LockScreen } from '@/components/LockScreen';
import { AdoptKeyScreen, usePendingAdoption } from '@/components/AdoptKeyScreen';
import { SecureAccountScreen, usePendingKeySetup } from '@/components/SecureAccountScreen';
import { PlaintextConsentDialog } from '@/components/PlaintextConsentDialog';

import '@/global.css';

// Suppress the on-device LogBox overlay -- the yellow/red toasts that sat over
// the bottom bar and repeatedly blocked the "+" button while testing.
//
// This only hides the on-screen overlay, and only in development (LogBox
// doesn't exist in release builds at all). Warnings and errors still print to
// the Metro console, so nothing is actually lost -- notably PowerSync's own
// "Sync error" logs, which were useful for diagnosis and are still there,
// just not painted over the UI.
LogBox.ignoreAllLogs(true);

/**
 * The two blocking key steps that can follow a sign-in, in priority order.
 *
 * Both sit ABOVE the unlocked app rather than replacing it: the account is
 * signed in and sync is deliberately still disconnected, so the note UI
 * underneath is this device's own local content and is fine to keep mounted.
 * They're opaque so none of it shows through.
 */
function KeyStepOverlay() {
  const adoption = usePendingAdoption();
  const keySetup = usePendingKeySetup();

  if (!adoption && !keySetup) return null;

  return (
    <View className="absolute inset-0 bg-white">
      {adoption ? <AdoptKeyScreen /> : <SecureAccountScreen />}
    </View>
  );
}

export default function RootLayout() {
  return (
    <GluestackUIProvider mode="light">
      <VaultProvider>
        <VaultGate />
      </VaultProvider>
    </GluestackUIProvider>
  );
}

/**
 * Decides what the user sees based on lock state.
 *
 * The ordering here is the whole point. Until the keys have been loaded once,
 * <AuthProvider> must not mount: it restores the Supabase session and calls
 * connectPowerSync(), and PowerSync cannot open the database without the
 * encryption key. Mounting it early wouldn't just be premature, it would throw.
 *
 * After that first load the app tree stays mounted for the rest of the
 * process, and re-locking only paints an overlay over it. That's what keeps
 * background sync alive while locked, and it means unlocking returns you to
 * the note you had open rather than a cold start.
 *
 * Note that with the lock off -- the default -- 'locked' never happens, and
 * this collapses to "show the app".
 */
function VaultGate() {
  const { status, hasBooted } = useVault();

  if (status === 'loading') {
    return <View className="flex-1 bg-white" />;
  }

  return (
    <View className="flex-1">
      {hasBooted ? (
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="enable-sync" options={{ presentation: 'modal' }} />
          </Stack>
        </AuthProvider>
      ) : null}

      {status === 'locked' ? (
        // Opaque and absolutely positioned rather than conditional, so the
        // note UI underneath is never briefly visible behind it.
        <View className="absolute inset-0 bg-white">
          <LockScreen />
        </View>
      ) : (
        // Rendered after the lock overlay so a locked device never shows
        // account content behind it.
        <KeyStepOverlay />
      )}

      {/* Last, so it sits above everything including the settings sheet it is
          usually triggered from. A consent prompt that can be obscured by the
          screen that raised it is a consent prompt people dismiss blind. */}
      <PlaintextConsentDialog />
    </View>
  );
}
