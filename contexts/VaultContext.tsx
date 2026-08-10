import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { authenticateWithDeviceCredential } from '@/lib/auth/deviceAuth';
import {
  DEFAULT_LOCK_SETTINGS,
  LockSettings,
  clearLegacyVault,
  createLocalVault,
  getLockSettings,
  hasLegacyVault,
  hasVault,
  setLockSettings,
  unlockWithDeviceKey,
  isUnlocked as vaultIsUnlocked,
} from '@/lib/crypto/vault';
import { wipeLocalDatabase } from '@/lib/powersync/migrateToEncrypted';
import { initPowerSync } from '@/lib/powersync/db';

/**
 * Owns the lock state of the app.
 *
 * Two separate ideas here, and conflating them is the easy mistake:
 *
 *   hasBooted   Have the keys been loaded at least once in this process?
 *               Until they have, there is no encryption key, so PowerSync
 *               cannot open the database and the note UI cannot be mounted.
 *
 *   status      Is the lock screen showing right now? After the first unlock
 *               this is purely a display concern -- the app stays mounted
 *               underneath and sync keeps running.
 *
 * That split is what lets re-locking hide the UI without tearing down the
 * database or disconnecting sync, so notes still upload while the phone is in
 * a pocket. What it protects is a casual pickup, not a memory dump of a
 * running process.
 *
 * The lock is OFF by default. The device's own passcode is what protects a
 * powered-off phone, and asking the user to authenticate twice to reach their
 * own notes is the friction this stage removed.
 */

export type VaultStatus = 'loading' | 'locked' | 'unlocked';

interface VaultContextValue {
  status: VaultStatus;
  /** True once the keys have been loaded at least once this launch. */
  hasBooted: boolean;
  lockSettings: LockSettings;
  /** Raises the OS prompt. A cancel leaves the app locked. */
  unlock: () => Promise<void>;
  lock: () => void;
  updateLockSettings: (next: LockSettings) => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside <VaultProvider>');
  return ctx;
}

/**
 * Load the keys into memory, creating a vault if there isn't a usable one.
 *
 * Returns false only if something is wrong enough that the note UI must not
 * mount. Two recoverable states are handled here rather than surfaced:
 *
 *   - a pre-6.5 vault, whose keys are wrapped under a PIN this app can no
 *     longer collect. Unreadable by construction, so it and its database go.
 *   - a vault whose device key has vanished from the keychain. Nothing it
 *     references can be decrypted, so the same treatment applies.
 */
async function loadKeys(): Promise<boolean> {
  if (await hasLegacyVault()) {
    await clearLegacyVault();
    wipeLocalDatabase();
  }

  if (!(await hasVault())) {
    wipeLocalDatabase();
    await createLocalVault();
    return true;
  }

  if (await unlockWithDeviceKey()) return true;

  // Vault present, device key gone. On iOS the keychain survives app deletion
  // while the data container does not, so odd pairings can outlive a
  // reinstall. Nothing here is recoverable locally -- signing in restores the
  // notes from the server.
  wipeLocalDatabase();
  await createLocalVault();
  return true;
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [hasBooted, setHasBooted] = useState(false);
  const [lockSettings, setLockSettingsState] = useState<LockSettings>(DEFAULT_LOCK_SETTINGS);
  const backgroundedAt = useRef<number | null>(null);

  // Read by the AppState listener, which is registered once and would
  // otherwise capture the settings as they were at mount.
  const lockRef = useRef(lockSettings);
  lockRef.current = lockSettings;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await getLockSettings();
      if (cancelled) return;
      setLockSettingsState(settings);

      if (settings.enabled) {
        // Keys stay unloaded until the OS prompt succeeds. LockScreen raises
        // it on mount, so this is not a dead end.
        setStatus('locked');
        return;
      }

      await loadKeys();
      await initPowerSync();
      if (cancelled) return;
      setHasBooted(true);
      setStatus('unlocked');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async () => {
    const outcome = await authenticateWithDeviceCredential('Unlock your notes');
    // 'cancelled' means the user was asked and declined -- staying locked is
    // the whole point. 'unavailable' means there is nothing to ask with, and
    // refusing someone their own notes over that would be a lockout rather
    // than a security measure.
    if (outcome === 'cancelled') return;

    if (!vaultIsUnlocked()) {
      await loadKeys();
    }
    // No-op after the first call, which is what makes the cold-launch path
    // and the re-lock path the same code.
    await initPowerSync();
    setHasBooted(true);
    setStatus('unlocked');
  }, []);

  const lock = useCallback(() => setStatus('locked'), []);

  const updateLockSettings = useCallback(async (next: LockSettings) => {
    await setLockSettings(next);
    setLockSettingsState(next);
  }, []);

  // Re-lock after a spell in the background. Measured on wall-clock rather
  // than a timer, because timers don't reliably fire while suspended -- a
  // phone left in a pocket overnight must come back locked.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next !== 'active' || backgroundedAt.current === null) return;

      const away = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;

      const { enabled, afterMs } = lockRef.current;
      if (enabled && away >= afterMs) setStatus('locked');
    });
    return () => subscription.remove();
  }, []);

  return (
    <VaultContext.Provider
      value={{ status, hasBooted, lockSettings, unlock, lock, updateLockSettings }}
    >
      {children}
    </VaultContext.Provider>
  );
}
