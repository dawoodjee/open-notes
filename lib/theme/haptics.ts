import { Platform } from 'react-native';

/**
 * The app's haptic vocabulary — three meanings, not thirty presets.
 *
 * ── WHY A WRAPPER ─────────────────────────────────────────────────────────
 *
 * `react-native-pulsar` exposes the whole system catalogue plus a large
 * Android-only set. Calling those directly from components would spread a
 * physical design decision across forty files, and what makes haptics feel
 * deliberate rather than noisy is that the SAME kind of event always feels the
 * same. So the app names meanings and this file maps them to presets.
 *
 * ── WHY THE IMPORT IS LAZY, WHICH IS THE PART THAT MATTERS ────────────────
 *
 * `react-native-pulsar` is a TurboModule, and importing it runs
 * `TurboModuleRegistry.getEnforcing('RNPulsar')` at MODULE SCOPE. If the native
 * binary does not contain it, that throws during import — before any of this
 * file's own code runs, so a `try` around the call site cannot catch it, and
 * the throw takes the whole app down at launch.
 *
 * That is not hypothetical. The package was added to package.json in 12a and
 * the native app was never rebuilt, so a static import here crashed the app on
 * boot with `'RNPulsar' could not be found. Verify that a module by this name
 * is registered in the native binary.` — found the first time it ran.
 *
 * `require` inside the guarded call, memoised, means a binary without the
 * module degrades to silence instead of to a crash. Which is the correct
 * behaviour anyway: haptics are the most optional thing in the app, and the
 * device that cannot play them is often the device that has no actuator.
 *
 * A rebuild (`expo prebuild` + `pod install` + `expo run:ios`) is what actually
 * turns them on. They cannot be confirmed on a simulator either way — no
 * simulator has a Taptic Engine — so the only real verification is a physical
 * device.
 */

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

type PresetFn = () => void;
type PulsarPresets = {
  System: { impactLight: PresetFn; selection: PresetFn; notificationSuccess: PresetFn };
};

/** `undefined` = not looked up yet; `null` = looked up and unavailable. */
let presets: PulsarPresets | null | undefined;

function load(): PulsarPresets | null {
  if (presets !== undefined) return presets;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    presets = require('react-native-pulsar').Presets as PulsarPresets;
  } catch {
    presets = null;
  }
  return presets;
}

function fire(pick: (p: PulsarPresets) => PresetFn) {
  if (!enabled) return;
  const loaded = load();
  if (!loaded) return;
  try {
    pick(loaded)();
  } catch {
    // No engine, no permission, or a preset this OS version does not have.
    // A missing tap is never worth an exception.
  }
}

export const haptics = {
  /** A control was pressed and did something. The default, and what every icon
   *  button fires — see IconButton for why they all feel the same. */
  tap: () => fire((p) => p.System.impactLight),
  /** Moving through a set: the next match, the next pane, a picker row. */
  step: () => fire((p) => p.System.selection),
  /** Something finished that pressing again will not undo — replace all, a
   *  note filed, a reset. */
  commit: () => fire((p) => p.System.notificationSuccess),
};
