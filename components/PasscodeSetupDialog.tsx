import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { PasscodePad, usePasscodeError } from '@/components/PasscodePad';
import { ModalBottomSheet } from '@/components/ModalSheet';
import { getDeviceKey } from '@/lib/crypto/vault';
import { enrolGate } from '@/lib/crypto/deviceKeyStore';
import { enrolBiometric, enrolPasscode, isBiometricGateAvailable } from '@/lib/crypto/webGate';
import { bytesToHex } from '@noble/ciphers/utils.js';

/**
 * Setting up the web lock, which has to happen BEFORE the lock is switched on.
 *
 * ── WHY THE ORDER IS NOT NEGOTIABLE ───────────────────────────────────────
 *
 * On web, locking discards the keys, and the only way back in is the gate. So
 * enabling the lock before a gate exists produces a tab that cannot be opened
 * by anybody -- not a security feature, a brick. The toggle therefore does not
 * write `enabled: true`; this dialog does, and only after an enrolment has
 * actually succeeded.
 *
 * The same reasoning is why `enrolBiometric` refuses to enrol when the
 * authenticator will not produce PRF output, rather than enrolling hopefully.
 *
 * ── TWO FACTORS, ONE OF WHICH IS NOT ALWAYS THERE ─────────────────────────
 *
 * A passkey is offered when the browser has a platform authenticator that
 * supports the PRF extension -- Touch ID, Face ID, Windows Hello. It is the
 * better option where it exists: the key material comes from hardware and there
 * is nothing to guess. PRF support in 2026 is good but not universal, so the
 * PIN is a real path rather than a fallback nobody reaches.
 */
export function PasscodeSetupDialog({
  isOpen,
  onCancel,
  onEnrolled,
}: {
  isOpen: boolean;
  onCancel: () => void;
  /** Fired only after the gate genuinely exists. */
  onEnrolled: () => void;
}) {
  const [stage, setStage] = useState<'choose' | 'enter' | 'confirm'>('choose');
  const [first, setFirst] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, flagError] = usePasscodeError();
  const [message, setMessage] = useState<string | null>(null);
  const [canUsePasskey, setCanUsePasskey] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    setStage('choose');
    setFirst('');
    setCode('');
    setMessage(null);
    void isBiometricGateAvailable().then(setCanUsePasskey);
  }, [isOpen]);

  const setUpPasskey = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const deviceKey = getDeviceKey();
      const ok = await enrolGate(
        () => enrolBiometric(deviceKey, 'Notes'),
        bytesToHex(deviceKey)
      );
      if (!ok) {
        setMessage('That passkey could not be set up. Use a PIN instead.');
        return;
      }
      onEnrolled();
    } finally {
      setBusy(false);
    }
  }, [onEnrolled]);

  const submit = useCallback(
    async (entered: string) => {
      if (stage === 'enter') {
        setFirst(entered);
        setCode('');
        setStage('confirm');
        return;
      }
      // Confirm stage. A mistyped PIN that is never noticed is a lockout, so
      // it is entered twice before anything is written.
      if (entered !== first) {
        flagError();
        setCode('');
        setFirst('');
        setStage('enter');
        setMessage('Those did not match. Try again.');
        return;
      }
      setBusy(true);
      try {
        const deviceKey = getDeviceKey();
        await enrolGate(async () => {
          await enrolPasscode(deviceKey, entered);
          return true;
        }, bytesToHex(deviceKey));
        onEnrolled();
      } finally {
        setBusy(false);
      }
    },
    [first, flagError, onEnrolled, stage]
  );

  return (
    <ModalBottomSheet
      nativeOverlay
      scrimColor="rgba(0,0,0,0.4)"
      detents={[0, 620]}
      index={isOpen ? 1 : 0}
      onSettle={(i) => {
        if (i === 0 && isOpen) onCancel();
      }}
      surface={<View className="flex-1 bg-background rounded-t-2xl" />}
    >
      <View className="flex-1 items-center px-8 pt-8 pb-10">
        <Text className="text-xl font-semibold text-foreground mb-2">
          {stage === 'choose'
            ? 'Lock this browser'
            : stage === 'enter'
              ? 'Choose a 6-digit PIN'
              : 'Enter it again'}
        </Text>

        <Text className="text-base text-muted-foreground text-center mb-8 max-w-sm">
          {stage === 'choose'
            ? 'Locking clears the keys from this tab, so your notes cannot be read until you unlock again.'
            : 'You will need this every time the app locks. Your 12-word recovery code still works if you forget it.'}
        </Text>

        {message ? <Text className="text-sm text-red-500 mb-4">{message}</Text> : null}

        {busy ? <ActivityIndicator /> : null}

        {stage === 'choose' ? (
          <View className="w-full max-w-xs gap-3">
            {canUsePasskey ? (
              <Pressable
                onPress={() => void setUpPasskey()}
                disabled={busy}
                className="px-6 py-3 rounded-full bg-lime-500 items-center"
                accessibilityRole="button"
                accessibilityLabel="Use a passkey"
              >
                <Text className="text-base font-medium text-on-accent">Use a passkey</Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => setStage('enter')}
              disabled={busy}
              className="px-6 py-3 rounded-full bg-muted items-center"
              accessibilityRole="button"
              accessibilityLabel="Use a PIN"
            >
              <Text className="text-base font-medium text-foreground">
                {canUsePasskey ? 'Use a PIN instead' : 'Set a PIN'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <PasscodePad
            value={code}
            onChange={setCode}
            onComplete={(entered) => void submit(entered)}
            disabled={busy}
            shake={error}
          />
        )}
      </View>
    </ModalBottomSheet>
  );
}
