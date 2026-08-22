import React, { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';
import { isSessionOnlyDatabase } from '@/lib/powersync/db';

/**
 * Where the notes on THIS device live, and the one lever for when that goes
 * wrong.
 *
 * ── WHY IT IS HERE AND NOT IN A SETTINGS › SYNC SCREEN ────────────────────
 *
 * Adam's call, 2026-08-22: "the manage account. we later need to think about
 * and centralize sync controls and account setup". Storage and recovery follow
 * the account, not the appearance settings, and inventing a Sync section now
 * would be inventing the very structure that decision says to think about
 * properly later. See the Decisions Log entry on centralising sync controls.
 *
 * ── WHY RESET IS OFFERED OUTSIDE THE FAILURE SCREEN AT ALL ────────────────
 *
 * It used to exist only there, which meant it was reachable only from an app
 * that had already failed to start. But the state it fixes is not always fatal:
 * a database that opens and then behaves oddly, a device holding notes from an
 * account the user no longer wants on it, a sync that will not settle. Those
 * leave the app running and, until now, left the user with nothing to do about
 * them from inside it.
 *
 * The two-step confirm is not ceremony. This destroys every note on the device
 * that has not reached the server, and that set is invisible from here.
 */
/**
 * `resetLocalData` arrives as a PROP rather than from `useVault()` here, and
 * that is not a style preference -- it is the only thing that works.
 *
 * This section renders inside Manage Account's Gluestack `Modal`, and that
 * modal PORTALS its children into the overlay host, which `GluestackUIProvider`
 * mounts OUTSIDE `<VaultProvider>` (see app/_layout.tsx -- the provider order
 * there is deliberate and correct for boot). React context follows the tree the
 * portal lands in, not the JSX it was written in, so calling `useVault()` from
 * inside the modal throws "useVault must be used inside <VaultProvider>". It
 * did, on the iPhone, the first time this screen was opened.
 *
 * The caller reads the hook at ITS top level -- outside the modal, still inside
 * the provider -- and passes the function down. Anything else this section ever
 * needs from a context has to arrive the same way.
 */
export function SyncRecoverySection({ onReset }: { onReset: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await onReset();
    } finally {
      setResetting(false);
      setConfirming(false);
    }
  };

  return (
    <SettingsGroup
      caption="Storage on this device"
      footnote={
        confirming
          ? 'This deletes every note stored on this device. Notes synced to your account come back when you sign in. Notes written before you signed in will not.'
          : isSessionOnlyDatabase
            ? 'On the web the database is held in memory, so closing this tab clears it. Export anything you want to keep. Nothing is written to browser storage, which is also why nothing about it can be read by another site.'
            : 'Notes are stored encrypted on this device. Only this device holds the key.'
      }
    >
      <SettingsRow
        label="Where notes are kept"
        value={isSessionOnlyDatabase ? 'This session only' : 'Encrypted on this device'}
        disabled
      />

      <SettingsRow
        label={confirming ? 'Yes, delete local notes' : 'Reset local data'}
        sublabel={confirming ? undefined : 'Use this if notes will not load or sync will not settle'}
        destructive
        onPress={confirming ? handleReset : () => setConfirming(true)}
        right={resetting ? <ActivityIndicator /> : undefined}
      />

      {confirming ? (
        <SettingsRow label="Cancel" onPress={() => setConfirming(false)} />
      ) : null}
    </SettingsGroup>
  );
}
