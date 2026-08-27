import { useEffect, useState } from 'react';

import type { InstallPrompt } from './install';
import { PWA_HEAD_TAGS } from './headTags';

/**
 * Service-worker registration and the install prompt.
 *
 * ── WHY REGISTRATION IS PRODUCTION-ONLY ───────────────────────────────────
 *
 * A service worker that caches the app shell is exactly wrong against a Metro
 * dev server: Metro rebuilds on every save, and a cache-first worker would
 * serve yesterday's bundle while the terminal cheerfully reports a successful
 * rebuild. That is a full afternoon of debugging a change that did apply. Dev
 * gets no worker at all.
 *
 * It also actively UNREGISTERS in dev, because a worker installed by a previous
 * production build on the same origin (localhost, most likely) would otherwise
 * outlive it and cause precisely that.
 */

const SW_URL = '/sw.js';

/**
 * Put the PWA head tags into the live document.
 *
 * The SHIPPED page gets them statically from `scripts/inject-pwa-head.ts`; this
 * is what makes `expo start --web` behave the same, so installability and the
 * theme colour can be looked at without doing a full export first. Idempotent,
 * because the built page already has them and this still runs there.
 */
export function injectPwaHead(): void {
  if (typeof document === 'undefined') return;

  for (const spec of PWA_HEAD_TAGS) {
    // `replaces` rather than blind append: a second `viewport` or `theme-color`
    // does not merge or override -- the first one wins, so appending a better
    // tag beside Expo's own would silently do nothing.
    const existing = spec.replaces ? document.head.querySelector(spec.replaces) : null;
    const element = document.createElement(spec.tag);
    for (const [name, value] of Object.entries(spec.attrs)) element.setAttribute(name, value);
    if (spec.text) element.textContent = spec.text;

    if (existing) existing.replaceWith(element);
    else document.head.appendChild(element);
  }
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  if (__DEV__) {
    // See above: a worker left over from a production build on this origin
    // would serve a stale bundle over the dev server.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) void registration.unregister();
    });
    return;
  }

  const register = () => {
    void navigator.serviceWorker.register(SW_URL).catch((err) => {
      // A failed registration costs offline support, not the app. Never fatal.
      console.warn('Service worker registration failed:', err);
    });
  };

  /**
   * Deferred to `load` so fetching the worker and its precache never competes
   * with the first paint -- BUT ONLY IF `load` IS STILL COMING.
   *
   * The plain `addEventListener('load', ...)` version registered nothing in the
   * built app, silently. Expo's bundle is `defer`red and this module is reached
   * through expo-router's lazy layout, so by the time it evaluates the document
   * is already `complete`: the listener was attached to an event that had
   * fired, and waited forever. No error, no worker, no offline support, and
   * nothing in the console to say so -- found by checking `document.readyState`
   * from the page rather than by trusting the code.
   */
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}

/**
 * `beforeinstallprompt` fires once, early, and the event is the ONLY handle on
 * the install dialog -- calling `prompt()` on anything else does nothing. So it
 * is captured at module scope rather than inside the hook: the event routinely
 * fires before React has mounted the component that wants it, and a hook that
 * only started listening on mount would miss it and report "not installable"
 * forever.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar so the app can offer the install
    // where it makes sense rather than over the notes.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    announce();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce();
  });
}

/** True when running as an installed app rather than in a browser tab. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari predates display-mode and reports this instead.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt(): InstallPrompt {
  const [canInstall, setCanInstall] = useState(deferred !== null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const update = () => {
      setCanInstall(deferred !== null);
      setInstalled(isStandalone());
    };
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  return {
    canInstall,
    isInstalled: installed,
    promptInstall: async () => {
      const event = deferred;
      if (!event) return;
      // Single-use: the browser will not accept the same event twice, and
      // keeping it would leave a button that silently does nothing.
      deferred = null;
      announce();
      await event.prompt();
      await event.userChoice;

      /**
       * Ask for durable storage once the app is installed.
       *
       * This is the moment it is likely to be GRANTED. Stage 13a measured
       * `persist()` returning false on a bare localhost origin -- Chrome
       * decides on engagement signals, and an installed PWA is the strongest
       * one. Until this point web storage is evictable, which for an
       * offline-first app is a data-loss path independent of encryption.
       */
      void navigator.storage?.persist?.().catch(() => {});
    },
  };
}
