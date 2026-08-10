import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSubHeader,
  SettingsToggle,
} from '@/components/ui/settings-group';
import { LockCapability, getLockCapability } from '@/lib/auth/deviceAuth';
import type { LockSettings } from '@/lib/crypto/vault';
import {
  GATE_WINDOW_OPTIONS,
  GateState,
  GateWindow,
  closeGate,
  getGateState,
  openGate,
} from '@/lib/plaintext/gates';
import { Disclosure, listDisclosures } from '@/lib/plaintext/broker';

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
  onManageEndpoints,
}: {
  onBack: () => void;
  lockSettings: LockSettings;
  updateLockSettings: (next: LockSettings) => Promise<void>;
  onManageEndpoints: () => void;
}) {
  const [capability, setCapability] = useState<LockCapability | null>(null);
  const [gate, setGate] = useState<GateState | null>(null);
  const [disclosures, setDisclosures] = useState<Disclosure[]>([]);

  const refreshGates = useCallback(async () => {
    setGate(await getGateState());
    setDisclosures(await listDisclosures(20));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getLockCapability().then((c) => {
      if (!cancelled) setCapability(c);
    });
    void refreshGates();
    return () => {
      cancelled = true;
    };
  }, [refreshGates]);

  const updateGate = async (on: boolean, window: GateWindow = 90) => {
    if (on) await openGate(window);
    else await closeGate();
    await refreshGates();
  };

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
          caption="Data access"
          footnote="Off, nothing can read your notes but this app. On, notes an outside request asks for are decrypted here and sent as readable text to an endpoint you choose. Your key never leaves this device, and the server still can’t read your notes on its own."
        >
          <GateRow
            label="Allow API access"
            state={gate ?? undefined}
            onToggle={updateGate}
          />
          <SettingsRow label="Manage endpoints" onPress={onManageEndpoints} />
        </SettingsGroup>

        {disclosures.length > 0 ? (
          <SettingsGroup
            caption="Recent disclosures"
            footnote="What has actually left this device. Recorded before each request, so a failed one still shows up."
          >
            {disclosures.slice(0, 5).map((d) => (
              <SettingsRow
                key={d.id}
                label={d.purpose || 'Request'}
                sublabel={`${d.noteIds.length} note${
                  d.noteIds.length === 1 ? '' : 's'
                } · ${new Date(d.occurredAt).toLocaleString()}`}
              />
            ))}
          </SettingsGroup>
        ) : null}

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

/**
 * A gate is two controls, not one: whether it's on, and for how long.
 *
 * The window only appears once the gate is on, so the default state stays a
 * single unambiguous switch. Turning one on defaults to 90 days rather than
 * Forever -- the safer of the two is the one you get by not thinking about it.
 */
function GateRow({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: GateState | undefined;
  onToggle: (on: boolean, window?: GateWindow) => void | Promise<void>;
}) {
  const enabled = state?.enabled ?? false;

  return (
    <>
      <SettingsRow
        label={label}
        sublabel={
          state?.expired
            ? 'Expired. Turn it back on to keep using it.'
            : enabled && state?.expiresAt
              ? `Until ${state.expiresAt.toLocaleDateString()}`
              : enabled
                ? 'No expiry'
                : undefined
        }
        right={
          <SettingsToggle value={enabled} onChange={(next) => void onToggle(next)} />
        }
      />
      {enabled ? (
        <View className="px-4 py-3">
          <RNText className="text-xs text-gray-400 mb-2">Allow for</RNText>
          <SettingsSegmented
            options={GATE_WINDOW_OPTIONS}
            value={windowFor(state)}
            onChange={(w) => void onToggle(true, w)}
          />
        </View>
      ) : null}
    </>
  );
}

/** Which window button to light up, recovered from the stored expiry. */
function windowFor(state: GateState | undefined): GateWindow {
  if (!state?.expiresAt) return 'never';
  const days = Math.round((state.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 30) return 30;
  if (days <= 90) return 90;
  return 365;
}
