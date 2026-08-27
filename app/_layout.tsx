import { useEffect } from 'react';
import { LogBox, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { AuthProvider } from '@/contexts/AuthContext';
import { VaultProvider, useVault } from '@/contexts/VaultContext';
import { LockScreen } from '@/components/LockScreen';
import { AdoptKeyScreen, usePendingAdoption } from '@/components/AdoptKeyScreen';
import { SecureAccountScreen, usePendingKeySetup } from '@/components/SecureAccountScreen';
import { PlaintextConsentDialog } from '@/components/PlaintextConsentDialog';
import { BootFailureScreen } from '@/components/BootFailureScreen';
import { BootSpinner } from '@/components/BootSpinner';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { StatusBar } from 'expo-status-bar';

import { injectPwaHead, registerServiceWorker } from '@/lib/pwa/install';

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
 * Hold the native splash until we control what replaces it.
 *
 * By default expo-router drops the splash the instant the first route mounts,
 * and the first thing to mount is a React tree that has not yet read the stored
 * appearance -- so a dark-mode launch got one light frame before the preference
 * arrived. Holding here means the splash covers that read.
 *
 * Module scope, not an effect: by the time an effect runs the first frame has
 * already been committed and the splash is already gone. The rejection is
 * swallowed because "too late to prevent" is the only way this fails, and it is
 * not worth crashing a launch over.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});

/** A launch that never settles must not sit on the splash forever. If the
 *  keychain read hangs, fall through and let BootSpinner -- which at least
 *  shows something is still happening -- take over. */
const SPLASH_MAX_HOLD_MS = 4000;

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
    <View className="absolute inset-0 bg-background">
      {adoption ? <AdoptKeyScreen /> : <SecureAccountScreen />}
    </View>
  );
}

/**
 * Offline support, registered once at launch.
 *
 * Module scope rather than an effect, for the same reason the splash hold above
 * is: by the time an effect runs the first paint has already happened, and the
 * worker's own `load` listener inside this call is what keeps it off the
 * critical path. A no-op on native -- see lib/pwa/install.ts.
 *
 * `injectPwaHead()` is the dev-server equivalent of what
 * scripts/inject-pwa-head.ts writes into the exported HTML: Expo's SPA output
 * emits a fixed template and ignores `app/+html.tsx`, so the manifest link has
 * to arrive one of those two ways. See lib/pwa/headTags.ts.
 */
registerServiceWorker();
injectPwaHead();

export default function RootLayout() {
  // ThemeProvider sits outermost: the appearance has to be settled before
  // anything paints, including the boot spinner and the failure screen, both
  // of which render before the database exists.
  //
  // GestureHandlerRootView wraps everything, and it has to be the OUTERMOST
  // view rather than sitting somewhere near the list that needs it. Every
  // gesture-handler recognizer in the tree resolves against the nearest root;
  // without one the swipe actions on a note row do nothing at all on Android
  // and behave inconsistently on iOS, with no error to explain why. `flex: 1`
  // is not optional either -- it defaults to shrinking to its content and the
  // whole app collapses to zero height.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ThemedRoot />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function ThemedRoot() {
  const { scheme, isReady } = useTheme();

  // Hand the splash over only once the appearance is settled, so that whatever
  // paints next is already the right colour. BootSpinner is drawn to match the
  // splash exactly, which is what makes this swap invisible rather than merely
  // fast.
  useEffect(() => {
    const hide = () => void SplashScreen.hideAsync().catch(() => {});
    if (isReady) {
      hide();
      return;
    }
    const timer = setTimeout(hide, SPLASH_MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [isReady]);

  // No `mode` prop: ThemeProvider owns Appearance, and passing the resolved
  // scheme here is what previously pinned the app so that the device switching
  // between light and dark never reached it. See the note in
  // components/ui/gluestack-ui-provider.
  return (
    <GluestackUIProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
/**
 * Routes that render without a database, and are allowed to when there isn't
 * one. All three are `__DEV__`-guarded harnesses that own their own fixture
 * data -- they touch neither the vault nor PowerSync.
 */
const DEV_ROUTES = ['/dev-chrome', '/dev-icons', '/dev-swipe'];

function VaultGate() {
  const { status, hasBooted, bootError, retryBoot, resetLocalData } = useVault();
  const pathname = usePathname();

  /**
   * WHY THE HARNESSES GET AN ESCAPE HATCH, and only on `failed`.
   *
   * This was written when web could not boot at all -- no keychain, no native
   * SQLite -- so every route there, including the harnesses built to verify the
   * desktop chrome, was replaced by BootFailureScreen. That is no longer true
   * (see lib/crypto/secureStorage.web.ts and lib/powersync/openDatabase.web.ts),
   * and web now reaches the real app.
   *
   * It stays because the harnesses are the one thing that should still render
   * when the database genuinely will not open, on any platform: they own their
   * own fixture data and touch neither the vault nor PowerSync, so a chrome
   * problem stays diagnosable while a storage problem is being fixed.
   *
   * AuthProvider is left out on purpose rather than by omission: it restores
   * the session and calls connectPowerSync(), which is precisely what cannot
   * work when the database did not open.
   */
  if (__DEV__ && status === 'failed' && DEV_ROUTES.includes(pathname)) {
    return (
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    );
  }

  if (status === 'loading') {
    // NotesLayout renders this same component while it settles on which note
    // to open, so the two holds read as one continuous load. See BootSpinner.
    return <BootSpinner />;
  }

  if (status === 'failed') {
    return <BootFailureScreen error={bootError} onRetry={retryBoot} onReset={resetLocalData} />;
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
        <View className="absolute inset-0 bg-background">
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
