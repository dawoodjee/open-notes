import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSubHeader,
  SettingsToggle,
} from '@/components/ui/settings-group';
import { LockCapability, getLockCapability } from '@/lib/auth/deviceAuth';
import type { LockSettings } from '@/lib/crypto/vault';

const LOCK_AFTER_OPTIONS = [
  { label: 'Now', value: 0 },
  { label: '5 min', value: 5 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
];

/**
 * Settings -> Security.
 *
 * The copy here is the product's honesty budget, so it is spent carefully:
 * one plain sentence about what is and isn't protected, no reassurance, and
 * no nudging someone toward a device passcode they've chosen not to set.
 *
 * TAKES THE LOCK SETTINGS AS PROPS RATHER THAN CALLING useVault(), and that is
 * not a style preference. Gluestack's <Modal> hoists its children to an
 * overlay root mounted by <GluestackUIProvider>, which sits ABOVE
 * <VaultProvider> in app/_layout.tsx -- so a hook reading React context from
 * in here finds nothing and throws "useVault must be used inside
 * <VaultProvider>". Props survive the hoist because they're bound when the
 * element is created, in the normal tree. ManageAccountDialog gets away with
 * useAuth() only because it calls it in its own body, outside its <Modal>.
 * Anything rendered inside a modal has to follow this rule.
 */
export function SecurityView({
  onBack,
  lockSettings,
  updateLockSettings,
}: {
  onBack: () => void;
  lockSettings: LockSettings;
  updateLockSettings: (next: LockSettings) => Promise<void>;
}) {
  const [capability, setCapability] = useState<LockCapability | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLockCapability().then((c) => {
      if (!cancelled) setCapability(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Null means we haven't asked the OS yet. Treating that as 'none' would make
  // the switch flicker from disabled to enabled on every open.
  const canLock = capability !== null && capability !== 'none';
  const biometric = capability === 'biometric';

  return (
    <>
      <SettingsSubHeader title="Security" onBack={onBack} />

      <ScrollView className="flex-1 px-5 pt-4 bg-white">
        <SettingsGroup
          caption="Lock"
          footnote={
            capability === 'none'
              ? 'No device lock is set. Anyone with this phone can open your notes. Your notes are still unreadable to the server and to anyone reading the app’s files directly.'
              : biometric
                ? 'Unlocks with Face ID, Touch ID, or your device passcode.'
                : 'Unlocks with your device passcode.'
          }
        >
          <SettingsRow
            label="Require unlock"
            sublabel={canLock ? undefined : 'Set a passcode on this device to use this.'}
            disabled={!canLock}
            right={
              <SettingsToggle
                value={lockSettings.enabled && canLock}
                disabled={!canLock}
                onChange={(next) => void updateLockSettings({ ...lockSettings, enabled: next })}
              />
            }
          />

          {lockSettings.enabled && canLock ? (
            <SettingsRow
              label="Ask again after"
              right={
                <SettingsSegmented
                  options={LOCK_AFTER_OPTIONS}
                  value={lockSettings.afterMs}
                  onChange={(afterMs) => void updateLockSettings({ ...lockSettings, afterMs })}
                />
              }
            />
          ) : null}
        </SettingsGroup>

        <SettingsGroup
          caption="Encryption"
          footnote="Your notes are encrypted on this device and stay encrypted on the server. Nobody else — including us — can read them."
        >
          <SettingsRow label="End-to-end encryption" value="On" />
        </SettingsGroup>

        <View className="h-8" />
      </ScrollView>
    </>
  );
}
