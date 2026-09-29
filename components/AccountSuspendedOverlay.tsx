import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { connectPowerSync, getPowerSync, isPowerSyncReady, readPersistedPending } from '@/lib/powersync/db';
import {
  cancelAccountDeletion,
  checkServerState,
  acknowledgeErasedNotice,
  eraseDeviceForPurgedAccount,
  forgetPersistedPending,
  restoreErasedNotice,
} from '@/lib/account/deletion';
import {
  clearCancelled,
  markCancelled,
  resolvePending,
  useSuspensionOverrides,
  type Pending,
} from '@/lib/account/suspension';
import { logout } from '@/lib/auth/logout';

/**
 * The whole app, replaced, while this account is pending deletion (Stage 15b).
 *
 * Decided (Decisions Log, 2026-09-28/29): during the 30 days every device stops
 * syncing and KEEPS its encrypted local copy, so cancelling needs no recovery
 * phrase; a suspended device keeps its session, because the app's sign-out
 * erases the device and would defeat the grace period.
 *
 * Opaque, so a suspended device shows nothing of the account behind it -- but
 * NOT above the lock screen. It deliberately has no zIndex: it is stacked by
 * render order, inside AuthProvider, and app/_layout.tsx renders the lock
 * overlay after AuthProvider. A zIndex here once put this screen OVER the lock,
 * which would have let anyone holding a locked phone cancel the deletion
 * without unlocking it.
 *
 * It also checks in with the server when the app opens and whenever it returns
 * to the foreground -- the only way a disconnected device can learn that the
 * deletion was cancelled elsewhere, or that the account is now gone. What it
 * does with the answer is deliberately conservative: see checkServerState.
 */
export function AccountSuspendedOverlay() {
  const pending = usePendingDeletion();
  const overrides = useSuspensionOverrides();

  // A previous session may have erased this device; say so now.
  useEffect(() => {
    void restoreErasedNotice();
  }, []);

  if (overrides.erasedNotice) return <ErasedNotice />;
  if (!pending) return null;
  return <Suspended pending={pending} />;
}

/** The synced row, adjusted for what this device has just done. */
function usePendingDeletion(): Pending | null {
  const overrides = useSuspensionOverrides();
  const [row, setRow] = useState<Pending | null>(null);
  // This device's own persisted request, for a restart before the row synced.
  const [persisted, setPersisted] = useState<Pending | null>(null);

  // Re-read on EVERY override change, not just request/cancel. Erasing the
  // device deletes the persisted record but changes neither of those, and the
  // first version -- keyed on those two -- kept showing "scheduled for
  // deletion" for a dead account after the user dismissed the erased notice.
  // Every set() in suspension.ts makes a new object, so this is exactly
  // "whenever anything changed".
  useEffect(() => {
    void readPersistedPending().then(setPersisted);
  }, [overrides]);

  useEffect(() => {
    if (!isPowerSyncReady()) return;
    const controller = new AbortController();
    getPowerSync().watch(
      'SELECT requested_at, purge_after FROM account_deletions LIMIT 1',
      [],
      {
        onResult: (result) => {
          const r = result.array[0] as { requested_at: string; purge_after: string } | undefined;
          setRow(r ? { requestedAt: r.requested_at, purgeAfter: r.purge_after } : null);
        },
        onError: (err) => console.warn('[account] pending-deletion watch failed:', err),
      },
      { signal: controller.signal }
    );
    return () => controller.abort();
  }, []);

  // Sync has removed the row after a cancel: the override has done its job.
  useEffect(() => {
    if (!row && overrides.cancelled) clearCancelled();
  }, [row, overrides.cancelled]);

  return resolvePending(row ?? persisted, overrides);
}

function Suspended({ pending }: { pending: Pending }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const date = new Date(pending.purgeAfter).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const checkIn = useCallback(async () => {
    // Belt and braces: connectPowerSync refuses while suspended, but a device
    // that was ALREADY connected when the row arrived has to be told to stop.
    if (isPowerSyncReady()) await getPowerSync().disconnect();
    const state = await checkServerState();
    if (state === 'cancelled') {
      // Cancelled from another device. Resume; sync will remove the row.
      await forgetPersistedPending();
      markCancelled();
      await connectPowerSync();
    } else if (state === 'purged') {
      await eraseDeviceForPurgedAccount();
    }
    // 'pending' and 'unknown' change nothing -- in particular, being offline
    // never erases anything.
  }, []);

  useEffect(() => {
    void checkIn().catch((err) => console.warn('[account] check-in failed:', err));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkIn().catch((err) => console.warn('[account] check-in failed:', err));
    });
    return () => sub.remove();
  }, [checkIn]);

  const cancel = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await cancelAccountDeletion();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Cancelling did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const eraseNow = async () => {
    if (!confirmErase) {
      setConfirmErase(true);
      return;
    }
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      className="absolute inset-0 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      accessibilityViewIsModal
    >
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' }}>
        <RNText className="text-2xl font-bold text-foreground" accessibilityRole="header">
          Your account is scheduled for deletion
        </RNText>
        <RNText className="text-base text-foreground">
          On {date}, this account and everything in it will be erased — every note, folder and setting,
          on every device.
        </RNText>
        <RNText className="text-base text-muted-foreground">
          Until then this device has stopped syncing and kept its notes, still encrypted, in case you change
          your mind. Cancelling brings everything back, here and on your other devices.
        </RNText>

        {message ? <RNText className="text-base text-red-600 dark:text-red-400">{message}</RNText> : null}

        <Pressable
          onPress={() => void cancel()}
          disabled={busy}
          className={`mt-2 px-6 py-3 rounded-full items-center ${busy ? 'bg-foreground/10' : 'bg-lime-500'}`}
          accessibilityRole="button"
          accessibilityLabel="Cancel deletion"
          accessibilityState={{ disabled: busy, busy }}
        >
          <RNText className={`text-base font-medium ${busy ? 'text-muted-foreground' : 'text-on-accent'}`}>
            {busy ? 'Working…' : 'Cancel deletion'}
          </RNText>
        </Pressable>

        {/*
          A way to finish with THIS device now rather than in 30 days. It is the
          app's ordinary sign-out, which erases the device; the account stays
          pending, and signing in again elsewhere can still cancel.
        */}
        <Pressable
          onPress={() => void eraseNow()}
          disabled={busy}
          className="px-6 py-3 items-center"
          accessibilityRole="button"
          accessibilityLabel={confirmErase ? 'Confirm: erase this device now' : 'Erase this device now'}
        >
          <RNText className="text-base font-medium text-red-600 dark:text-red-400">
            {confirmErase ? 'Tap again to erase this device' : 'Erase this device now'}
          </RNText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ErasedNotice() {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="absolute inset-0 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      accessibilityViewIsModal
    >
      <View style={{ padding: 24, gap: 16, flex: 1, justifyContent: 'center' }}>
        <RNText className="text-2xl font-bold text-foreground" accessibilityRole="header">
          Your account has been deleted
        </RNText>
        <RNText className="text-base text-muted-foreground">
          Its 30 days ran out, so the account and everything in it are gone, and this device has been
          erased too.
        </RNText>
        <Pressable
          onPress={() => void acknowledgeErasedNotice()}
          className="mt-2 px-6 py-3 rounded-full items-center bg-lime-500"
          accessibilityRole="button"
          accessibilityLabel="OK"
        >
          <RNText className="text-base font-medium text-on-accent">OK</RNText>
        </Pressable>
      </View>
    </View>
  );
}
