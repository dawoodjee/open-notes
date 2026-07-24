import { Slot } from 'expo-router';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';

import '@/global.css';

export default function RootLayout() {
  return (
    <GluestackUIProvider mode="light">
      <Slot />
    </GluestackUIProvider>
  );
}
