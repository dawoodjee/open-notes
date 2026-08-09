import { LogBox } from 'react-native';
import { Stack } from 'expo-router';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { AuthProvider } from '@/contexts/AuthContext';

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
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="enable-sync" options={{ presentation: 'modal' }} />
        </Stack>
      </AuthProvider>
    </GluestackUIProvider>
  );
}
