/**
 * Progressive-web-app plumbing. Native has none of it.
 *
 * A seam rather than a `Platform.OS` branch because the web file touches
 * `navigator.serviceWorker` and `window`, neither of which exists in React
 * Native -- and the failure would be at import, which no runtime check can
 * catch. Same pattern as every other seam in this tree.
 */

export function registerServiceWorker(): void {
  // Nothing to register: a native app is already installed.
}

/** Web only -- there is no document here. See install.web.ts. */
export function injectPwaHead(): void {}

export interface InstallPrompt {
  /** True once the browser has offered an install, and not before. */
  canInstall: boolean;
  /** Raises the browser's own install dialog. Resolves once it is dismissed. */
  promptInstall: () => Promise<void>;
  /** True when the app is already running as an installed PWA. */
  isInstalled: boolean;
}

export function useInstallPrompt(): InstallPrompt {
  return { canInstall: false, promptInstall: async () => {}, isInstalled: true };
}
