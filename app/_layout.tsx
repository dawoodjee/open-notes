import { LogBox, View } from 'react-native';
import { Stack } from 'expo-router';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { AuthProvider } from '@/contexts/AuthContext';
import { VaultProvider, useVault } from '@/contexts/VaultContext';
import { PinSetupScreen, PinUnlockScreen } from '@/components/PinScreen';
import { AdoptKeyScreen, usePendingAdoption } from '@/components/AdoptKeyScreen';

function AdoptKeyOverlay() {
  const pending = usePendingAdoption();
  if (!pending) return null;
  return (
    <View className="absolute inset-0 bg-white">
      <AdoptKeyScreen />
    </View>
  );
}

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
 * The ordering here is the whole point. Until the vault has been unlocked
 * once, <AuthProvider> must not mount: it restores the Supabase session and
 * calls connectPowerSync(), and PowerSync cannot open the database without
 * the encryption key. Mounting it early wouldn't just be premature, it would
 * throw.
 *
 * After that first unlock the app tree stays mounted for the rest of the
 * process, and re-locking only paints an overlay over it. That's what keeps
 * background sync alive while locked, and it means unlocking returns you to
 * the note you had open rather than a cold start.
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

      {status !== 'unlocked' ? (
        // Opaque and absolutely positioned rather than conditional, so the
        // note UI underneath is never briefly visible behind it.
        <View className="absolute inset-0 bg-white">
          {status === 'needs-setup' ? <PinSetupScreen /> : <PinUnlockScreen />}
        </View>
      ) : (
        // Sits above the unlocked app, not instead of it: the account is
        // signed in and sync is deliberately still disconnected until the
        // recovery code arrives. Rendered after the lock overlay so a locked
        // device never shows account content behind it.
        <AdoptKeyOverlay />
      )}
    </View>
  );
}
