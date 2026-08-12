import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Image, View } from 'react-native';
import { SPLASH_BACKGROUND, useTheme } from '@/contexts/ThemeContext';

/**
 * The one frame the app is allowed to show before it has anything real to
 * display -- painted to be indistinguishable from the native splash behind it.
 *
 * Two places hold launch back, and they run back to back: VaultGate, while the
 * keychain is read and the encrypted database is opened (app/_layout.tsx), and
 * NotesLayout, while the last-opened note is restored and the first query
 * returns. Rendering the same component in both is what makes that read as one
 * uninterrupted load rather than two -- two separately-written spinners can
 * drift in colour, size or centring, and any of those differences shows up as
 * a flicker at the handover precisely because the swap happens mid-load.
 *
 * WHY IT LOOKS LIKE THE SPLASH. This used to be a bare `bg-background` view,
 * which meant every cold start went cream (splash) -> white (here) -> white
 * (app). That middle step was the visible jolt: not a slow launch, a
 * mismatched one. Now the splash hands over to an identical frame, so the logo
 * simply does not move and there is nothing to notice. The step to the app's
 * own white still exists, but it happens later, when the note list actually
 * arrives -- a colour change that coincides with content reads as loading,
 * one against a blank screen reads as a glitch.
 *
 * The numbers below are not free choices; they mirror what prebuild generated
 * from app.json:
 *
 *   - 288 is `imageWidth` in the expo-splash-screen plugin block. iOS lays the
 *     logo out in a 288pt box centred in the window (see the generated
 *     ios/Notes/SplashScreen.storyboard); matching it here means matching both
 *     platforms, since Android scales the same 1024px source into the same box.
 *   - The source PNGs are the same two files app.json points at. Requiring them
 *     directly is what guarantees they cannot drift apart.
 *
 * The spinner is not decoration either. An empty View here is what once made a
 * hung boot look identical to a dead one, with no way to tell "still working"
 * from "gave up" without a debugger. It is held back briefly so that a boot
 * which beats it shows no spinner at all -- see SPINNER_DELAY_MS.
 */

/** How long the logo holds alone before a spinner admits this is taking a while.
 *  Short enough to still answer "is it working?", long enough that a warm start
 *  never flashes a spinner it did not need. */
const SPINNER_DELAY_MS = 350;

const SPLASH_LOGO = {
  light: require('@/assets/images/splash-light.png'),
  dark: require('@/assets/images/splash-dark.png'),
};

/** Matches `imageWidth` in app.json's expo-splash-screen block. */
const LOGO_BOX = 288;

export function BootSpinner() {
  const { scheme } = useTheme();
  const spinnerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(spinnerOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, SPINNER_DELAY_MS);

    return () => clearTimeout(timer);
  }, [spinnerOpacity]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: SPLASH_BACKGROUND[scheme],
      }}
    >
      <Image
        source={SPLASH_LOGO[scheme]}
        style={{ width: LOGO_BOX, height: LOGO_BOX }}
        resizeMode="contain"
      />

      {/* Absolutely positioned so that its arrival cannot nudge the logo. A
          centred column would re-centre itself the moment the spinner faded
          in, and a logo that shifts is exactly the flicker this whole file
          exists to avoid. */}
      <Animated.View
        style={{
          position: 'absolute',
          bottom: '22%',
          opacity: spinnerOpacity,
        }}
      >
        <ActivityIndicator color="#84CC16" />
      </Animated.View>
    </View>
  );
}
