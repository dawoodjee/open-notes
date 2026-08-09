import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  createVault,
  hasVault,
  markSetupComplete,
  isUnlocked as vaultIsUnlocked,
  unlockWithPin,
} from '@/lib/crypto/vault';
import { getUiState, initPowerSync, isPowerSyncReady, saveUiState } from '@/lib/powersync/db';

/**
 * Owns the lock state of the app.
 *
 * Two separate ideas here, and conflating them is the easy mistake:
 *
 *   hasBooted   Has the vault been unlocked at least once in this process?
 *               Until it has, there is no encryption key, so PowerSync cannot
 *               open the database and the note UI cannot be mounted at all.
 *
 *   status      Is the lock screen showing right now? After the first unlock
 *               this is purely a display concern -- the app stays mounted
 *               underneath and sync keeps running.
 *
 * That split is what implements the Stage 6 decision to keep the data key in
 * memory while locked. Re-locking hides the UI; it does not tear down the
 * database or disconnect sync, so notes still upload while the phone is in a
 * pocket. What it protects is a powered-off device and a casual pickup, not a
 * memory dump of a running process.
 */

const LOCK_AFTER_MS = 5 * 60 * 1000;

/**
 * How long the PIN can go untyped before we ask for it on purpose.
 *
 * The vault stays unlocked across short backgrounding, so someone can use the
 * app daily for months and never type the PIN once. Then the day they need it
 * -- a new phone, a restore -- it's gone, and the only way back in is the
 * recovery code they filed away and probably can't find either. A periodic
 * check is cheap insurance against that.
 */
const PIN_REMINDER_MS = 14 * 24 * 60 * 60 * 1000;

export type VaultStatus = 'loading' | 'needs-setup' | 'locked' | 'unlocked';

/** Why the lock screen is showing, so it can explain itself. */
export type LockReason = 'normal' | 'reminder';

interface VaultContextValue {
  status: VaultStatus;
  lockReason: LockReason;
  /** True once the vault has been unlocked at least once this launch. */
  hasBooted: boolean;
  /** Returns the recovery code. Does NOT finish setup -- see finishSetup. */
  beginSetup: (pin: string) => Promise<string>;
  /** Called once the user has confirmed they saved the recovery code. */
  finishSetup: () => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  lock: () => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside <VaultProvider>');
  return ctx;
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [lockReason, setLockReason] = useState<LockReason>('normal');
  const [hasBooted, setHasBooted] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const exists = await hasVault();
      if (cancelled) return;
      setStatus(exists ? 'locked' : 'needs-setup');
    })();
    return () => {
      cancelled = true;
    };
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
      if (away >= LOCK_AFTER_MS && vaultIsUnlocked()) {
        setLockReason('normal');
        setStatus('locked');
        return;
      }

      // Otherwise: has it simply been too long since the PIN was last typed?
      void (async () => {
        if (!isPowerSyncReady() || !vaultIsUnlocked()) return;
        const { lastPinEntryAt } = await getUiState();
        if (!lastPinEntryAt) return;
        if (Date.now() - new Date(lastPinEntryAt).getTime() < PIN_REMINDER_MS) return;
        setLockReason('reminder');
        setStatus('locked');
      })();
    });
    return () => subscription.remove();
  }, []);

  /** Only ever records WHEN the PIN was entered. The PIN itself is never
   *  stored, logged, or transmitted anywhere. */
  const recordPinEntry = useCallback(async () => {
    try {
      await saveUiState({ lastPinEntryAt: new Date().toISOString() });
    } catch {
      // A missed timestamp costs an earlier-than-needed reminder, which is
      // not worth failing an unlock over.
    }
  }, []);

  const beginSetup = useCallback(async (pin: string) => {
    const { recoveryCode } = await createVault(pin);
    return recoveryCode;
  }, []);

  const finishSetup = useCallback(async () => {
    // Marked complete only here, after the recovery code has been shown and
    // typed back. Until this runs, hasVault() reports false and setup starts
    // over -- see StoredVault.setupComplete.
    await markSetupComplete();
    await initPowerSync();
    await recordPinEntry();
    setHasBooted(true);
    setStatus('unlocked');
  }, [recordPinEntry]);

  const unlock = useCallback(async (pin: string) => {
    // Always verifies against the wrapped blob rather than trusting the
    // in-memory key. After a re-lock the key IS still in memory, so a cheaper
    // check would be no check at all.
    await unlockWithPin(pin);
    // No-op after the first call, which is what makes the cold-launch path
    // and the re-lock path the same code.
    await initPowerSync();
    await recordPinEntry();
    setHasBooted(true);
    setLockReason('normal');
    setStatus('unlocked');
  }, [recordPinEntry]);

  const lock = useCallback(() => {
    setLockReason('normal');
    setStatus('locked');
  }, []);

  return (
    <VaultContext.Provider
      value={{ status, lockReason, hasBooted, beginSetup, finishSetup, unlock, lock }}
    >
      {children}
    </VaultContext.Provider>
  );
}
