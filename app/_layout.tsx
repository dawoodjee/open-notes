import { Stack } from 'expo-router';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { AuthProvider } from '@/contexts/AuthContext';

import '@/global.css';

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
