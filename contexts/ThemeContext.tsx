import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Appearance, ColorSchemeName, Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';

/**
 * Which appearance the user picked, and what that resolves to right now.
 *
 * HOW THEMING WORKS HERE, because it isn't NativeWind's own API. NativeWind
 * v5-preview deprecated its useColorScheme in favour of React Native's
 * (`@deprecated Use useColorScheme from "react-native" instead`), so the one
 * switch that drives everything is RN's:
 *
 *     Appearance.setColorScheme('light' | 'dark' | null)   // null = follow OS
 *
 * That single call drives Tailwind's `dark:` variants AND the
 * `@media (prefers-color-scheme: dark)` block in global.css, which is where
 * the --background / --foreground / --border token values live. So components
 * written in semantic tokens (bg-background, text-foreground) flip on their
 * own with no prop threading and no re-render plumbing.
 *
 * components/ui/gluestack-ui-provider does exactly this already -- which is
 * why a hardcoded <GluestackUIProvider mode="light"> was what pinned the whole
 * app light. It now takes its mode from here.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * How an unordered list draws its markers.
 *
 * There is only ONE bullet-list node in the editor -- typing `- `, `+ ` or `* `
 * all produce the same `bulletList`, and so does the toolbar button. So this is
 * necessarily a document-wide choice rather than a per-list one. Storing the
 * marker per list would mean a new attribute on every <ul> in every note, and
 * TenTap can only hand JSON across the bridge to its prebuilt editor bundle --
 * a custom Tiptap extension would mean building and shipping our own bundle.
 *
 * Nothing about the note changes either way: the stored HTML stays plain
 * <ul><li>, and this only decides what gets painted beside it.
 */
export type BulletStyle = 'dash' | 'dot';

/**
 * SecureStore, NOT the ui_state table, and not for secrecy.
 *
 * The theme has to be readable BEFORE the encrypted database opens: the boot
 * spinner, the lock screen and the boot-failure screen all render while
 * PowerSync doesn't exist yet. Reading it from ui_state would mean every one
 * of those paints in the wrong colours first. This is the same constraint that
 * already made lock settings mirror into the SecureStore vault blob.
 */
const THEME_KEY = 'notes.appearance.v1';

/**
 * Beside the theme, and for a weaker reason than the theme's.
 *
 * This one has no need to beat the database open -- nothing paints a bullet
 * before the editor exists. It lives here because RichEditor already calls
 * useTheme() and SettingsDialog already threads this context's values through
 * the modal hoist, so putting it anywhere else would mean a second store and a
 * second prop thread to carry one string.
 */
const BULLET_KEY = 'notes.bulletStyle.v1';

/**
 * The one place a literal background colour is allowed.
 *
 * Everything styleable goes through `bg-background`. These values exist for
 * the handful of places a Tailwind class cannot reach: the native root view
 * behind React's tree, and third-party components taking a `style` prop rather
 * than a className. Kept in step with --background in global.css by hand,
 * which is exactly why the list is kept this short.
 */
export const BACKGROUND = { light: '#ffffff', dark: '#0a0a0a' } as const;

/**
 * The launch screen's background, which is NOT the app's.
 *
 * These two values are owned by the expo-splash-screen plugin block in
 * app.json and baked into the native projects at prebuild time -- iOS gets a
 * SplashScreenBackground.colorset, Android gets values/colors.xml and
 * values-night/colors.xml. Nothing reads app.json at runtime, so the only way
 * for JavaScript to paint the same colour is to repeat it here.
 *
 * Duplicated by necessity, therefore, and the duplication has to be maintained
 * by hand: change one and the boot screen stops matching the frame before it,
 * which is the exact seam this constant exists to hide.
 *
 * Light is deliberately the brand cream rather than the app's white -- the step
 * to white happens later, when the note list arrives.
 */
export const SPLASH_BACKGROUND = { light: '#f5ede4', dark: '#0a0a0a' } as const;

interface ThemeContextValue {
  preference: ThemePreference;
  /** What the preference actually resolves to right now. 'system' follows the
   *  device, so this is the value to branch on when a literal colour is
   *  unavoidable -- the WebView stylesheet, a status bar style. */
  scheme: 'light' | 'dark';
  setPreference: (next: ThemePreference) => Promise<void>;
  bulletStyle: BulletStyle;
  setBulletStyle: (next: BulletStyle) => Promise<void>;
  /** Has the stored preference been read yet? Only the native splash cares:
   *  it stays up until this flips, so a dark launch never paints a light frame
   *  while SecureStore is still being read. See app/_layout.tsx. */
  isReady: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

function toColorScheme(preference: ThemePreference): ColorSchemeName {
  // null is what "follow the device" is spelled as. Passing the string
  // 'system' straight through -- which gluestack's provider does -- is not the
  // same thing: setColorScheme only understands 'light', 'dark' and null.
  return preference === 'system' ? null : preference;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [bulletStyle, setBulletStyleState] = useState<BulletStyle>('dash');
  const [isReady, setIsReady] = useState(false);
  const deviceScheme = useColorScheme();

  useEffect(() => {
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      } catch {
        // A missing or unreadable preference is not worth failing a launch
        // over -- 'system' is a perfectly good answer.
      }
      try {
        const stored = await SecureStore.getItemAsync(BULLET_KEY);
        if (stored === 'dash' || stored === 'dot') {
          setBulletStyleState(stored);
        }
      } catch {
        // Same reasoning: 'dash' is a perfectly good answer.
      }
      // Outside both catches on purpose: "ready" means the read has been
      // ATTEMPTED, not that it succeeded. A failed read still settles the
      // appearance -- on the default -- and leaving the splash up over a
      // decision that has already been made would hang the launch.
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(toColorScheme(preference));
  }, [preference]);

  const scheme: 'light' | 'dark' =
    preference === 'system' ? (deviceScheme === 'dark' ? 'dark' : 'light') : preference;

  // The native root view behind React's tree. Without this a dark launch shows
  // a white flash before the first frame paints -- the one bit of theming no
  // amount of styling inside the app can reach.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(BACKGROUND[scheme]);
  }, [scheme]);

  // Android's navigation bar buttons, which are a SEPARATE system flag from
  // everything above and were the one piece never being updated -- switching
  // theme left the old icon colour behind while other apps flipped correctly.
  //
  // Only the button style is set, and that is not an omission. With
  // edgeToEdgeEnabled the platform owns the bar itself: it is transparent, our
  // content draws behind it, and setBackgroundColorAsync/setPositionAsync are
  // inert there. What is left to control is whether the icons are drawn light
  // or dark -- and note the value is the opposite of the scheme's name, because
  // it describes the BUTTONS, not the background they sit on.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void NavigationBar.setButtonStyleAsync(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme]);

  const setPreference = useCallback(async (next: ThemePreference) => {
    setPreferenceState(next);
    try {
      await SecureStore.setItemAsync(THEME_KEY, next);
    } catch {
      // The choice still applies for this launch; only persistence failed.
    }
  }, []);

  const setBulletStyle = useCallback(async (next: BulletStyle) => {
    setBulletStyleState(next);
    try {
      await SecureStore.setItemAsync(BULLET_KEY, next);
    } catch {
      // The choice still applies for this launch; only persistence failed.
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ preference, scheme, setPreference, bulletStyle, setBulletStyle, isReady }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
