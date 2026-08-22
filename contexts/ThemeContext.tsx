import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Appearance, ColorSchemeName, Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';
import { Layers, Sparkles, Square, Sunrise } from 'lucide-react-native';

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
 * A THEME is the app's whole visual identity: how chrome surfaces are painted
 * and which palette they are painted in. It is a SEPARATE axis from dark mode,
 * and that separation is the point -- every theme has its own light face and
 * its own dark face, so choosing `horizon` does not mean choosing dark, it
 * means choosing which dark (and which light) you get.
 *
 * `flat` is what the app looks like today and is the only one that exists.
 * The other three are listed in Settings deliberately rather than hidden: the
 * layout is then final, and it says what the app is going to be instead of
 * concealing it. Same reasoning as the greyed-out formatting controls.
 */
export type AppTheme = 'flat' | 'glass' | 'cosmic' | 'horizon';

export interface ThemeDescriptor {
  value: AppTheme;
  label: string;
  /** What it is, in one line, for the settings row. */
  blurb: string;
  /** False renders the row disabled and marked "Coming soon". */
  available: boolean;
  /**
   * EVERY theme carries one, including the unbuilt ones. Giving an icon only
   * to the built theme left the other three labels starting further left, so
   * the group had no common text edge -- the same defect as the folder rows,
   * for the same reason: an absent icon is not a zero-width icon.
   */
  icon: React.ComponentType<any>;
}

/** Render order in Settings -> Appearance -> Theme. */
export const APP_THEMES: ThemeDescriptor[] = [
  {
    value: 'flat',
    label: 'Flat',
    blurb: 'Solid surfaces, no blur. The current look.',
    available: true,
    icon: Square,
  },
  {
    value: 'glass',
    label: 'Glass',
    blurb: 'Translucent chrome that blurs the note behind it.',
    available: false,
    icon: Layers,
  },
  {
    value: 'cosmic',
    label: 'Cosmic',
    blurb: 'Deep space colour, for both faces.',
    available: false,
    icon: Sparkles,
  },
  {
    value: 'horizon',
    label: 'Horizon',
    blurb: 'Night sky after dark, daylight before it.',
    available: false,
    icon: Sunrise,
  },
];

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

/** Separate key rather than folded into the appearance one: dark mode and
 *  theme are independent choices, and a combined value would need a migration
 *  the first time either list changes. */
const APP_THEME_KEY = 'notes.theme.v1';

/**
 * The one place a literal background colour is allowed.
 *
 * Everything styleable goes through `bg-background`. These values exist for
 * the handful of places a Tailwind class cannot reach: the native root view
 * behind React's tree, and third-party components taking a `style` prop rather
 * than a className. Kept in step with --background in global.css by hand,
 * which is exactly why the list is kept this short.
 */
export const BACKGROUND = { light: '#fbfbfd', dark: '#0a0a0c' } as const;

/**
 * The label colour for anything sitting on a fixed accent fill -- the lime
 * primary buttons and the red destructive ones.
 *
 * Same escape hatch as BACKGROUND above, for the same reason: ActivityIndicator
 * takes a `color` prop, not a className, so `text-on-accent` cannot reach it.
 * Kept in step with --on-accent in global.css by hand.
 *
 * Deliberately NOT scheme-keyed. The accent fills underneath it are fixed
 * colours that do not flip with the theme, so a label that flipped would end up
 * near-black on lime in dark mode.
 */
export const ON_ACCENT = '#fbfbfd';

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
  /** The visual identity. Independent of `preference` -- see AppTheme. */
  theme: AppTheme;
  setTheme: (next: AppTheme) => Promise<void>;
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
  const [theme, setThemeState] = useState<AppTheme>('flat');
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
      try {
        const stored = await SecureStore.getItemAsync(APP_THEME_KEY);
        // Checked against the catalogue's AVAILABLE entries, not just the
        // union. A build that drops a theme, or a device that stored one
        // before it shipped, must not leave the app pointing at a theme this
        // binary cannot paint -- it would render nothing and look like a bug.
        const known = APP_THEMES.find((t) => t.value === stored && t.available);
        if (known) setThemeState(known.value);
      } catch {
        // 'flat' is a perfectly good answer.
      }
      // Outside both catches on purpose: "ready" means the read has been
      // ATTEMPTED, not that it succeeded. A failed read still settles the
      // appearance -- on the default -- and leaving the splash up over a
      // decision that has already been made would hang the launch.
      setIsReady(true);
    })();
  }, []);

  useEffect(() => {
    const next = toColorScheme(preference);

    /**
     * WEB HAS NO `setColorScheme`. `react-native-web`'s Appearance module
     * implements the listener half of the API and not the setter, so this line
     * threw `Appearance.default.setColorScheme is not a function` from inside
     * ThemeProvider and took the whole web app down before first paint. That
     * is the boot failure Stage 13 recorded and Stage 12b was asked to clear.
     *
     * The feature check rather than a `Platform.OS` check because it is the
     * honest test: what matters is whether the function exists.
     */
    if (typeof Appearance.setColorScheme === 'function') {
      Appearance.setColorScheme(next);
    }

    /**
     * On web the equivalent lever is a class on the document root -- global.css
     * already defines `:root.dark` and `:root.light` alongside its
     * prefers-color-scheme block, so the token values follow from here with no
     * new CSS. No class at all is how "follow the device" is spelled, which
     * leaves the media query in charge.
     *
     * PARTIAL, AND WORTH KNOWING: this moves the TOKENS (bg-background,
     * text-foreground and the rest). Tailwind v4's `dark:` UTILITY variant
     * still compiles to `@media (prefers-color-scheme: dark)` because this
     * project has no `@custom-variant dark`, so on web those utilities keep
     * following the OS regardless of the in-app preference. Adding that
     * variant changes how global.css compiles for native too, so it belongs to
     * Stage 13's web pass rather than to a boot fix.
     */
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      if (next) root.classList.add(next);
    }
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

  const setTheme = useCallback(async (next: AppTheme) => {
    // Guard rather than trust the caller: Settings disables the unavailable
    // rows, but this is the only place that can promise a theme is paintable.
    if (!APP_THEMES.some((t) => t.value === next && t.available)) return;
    setThemeState(next);
    try {
      await SecureStore.setItemAsync(APP_THEME_KEY, next);
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
      value={{ preference, scheme, setPreference, bulletStyle, setBulletStyle, theme, setTheme, isReady }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
