import React, { useCallback, useEffect, useState } from 'react';
import { Text as RNText, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OtpInput } from 'react-native-otp-entry';
import { useRouter } from 'expo-router';

import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { SettingsHeader } from '@/components/ui/settings-group';
import { UserRound, X } from 'lucide-react-native';

import { supabase } from '@/lib/supabase/client';
import { isValidEmail, normalizeEmail } from '@/lib/validation/email';
import { signInWithGoogle } from '@/lib/auth/oauth';
import { useAuth } from '@/contexts/AuthContext';
import { BACKGROUND, useTheme } from '@/contexts/ThemeContext';

type Step = 'email' | 'code';

// react-native-otp-entry styles through plain style objects rather than
// className, so the theme tokens cannot reach it and these have to be resolved
// here. Same reason ThemeContext.BACKGROUND exists.
const OTP_BORDER = { light: '#e5e5e5', dark: '#2e2e2e' } as const;
const OTP_TEXT = { light: '#0a0a0a', dark: '#fafafa' } as const;
// The lime the rest of the sign-in flow already uses for its primary action.
const OTP_FOCUS = '#84CC16';

// Reached only by tapping "Manage Sync" in the avatar menu -- never shown
// automatically on launch. Email OTP entry (two steps: request code, verify
// code) plus Google. Apple omitted for now -- no real credentials yet
// (Stage 4 left it disabled), and a dead button would be untested UI debt.
//
// This screen signs you in and nothing else. It used to grow a third step
// asking a new account to pick a username, which meant profile setup lived in
// two places at once: here for the first time, and Manage Account forever
// after. Two implementations of the same thing drift, and it put an errand
// between the user and the app they were trying to reach. Manage Account now
// owns profile details outright -- it seeds a new account's name and a free
// username from the sign-in provider, so the step wasn't buying much anyway.
export default function EnableSyncScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { scheme } = useTheme();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * router.back() alone is not enough, and that is the second half of why this
   * screen used to stay open. Back is a no-op when this modal is the only
   * entry in the history stack -- which is exactly the case when the app was
   * launched straight into it, or after a Google round trip through the
   * browser rebuilt the stack.
   */
  const dismiss = useCallback(() => {
    if (router.canDismiss()) router.dismiss();
    else router.replace('/');
  }, [router]);

  /**
   * Close when a session EXISTS, not when a particular call reports one.
   *
   * Dismissal used to be three separate router.back() calls, each conditional
   * on its own code path returning a session. Any route to being signed in
   * that those three didn't cover left the sheet sitting on screen over an app
   * that was, in fact, already signed in. Watching the session covers every
   * route by construction, including ones added later: AuthContext's
   * onAuthStateChange is the single funnel all of them pass through.
   */
  useEffect(() => {
    if (session) dismiss();
  }, [session, dismiss]);

  // Validity is enforced by the button being unavailable, not by telling
  // someone their half-typed address is wrong. An address is invalid for most
  // of the time it is being typed, so anything that reacts while typing is
  // wrong more often than it is right.
  const emailIsValid = isValidEmail(email);

  async function handleSendCode() {
    // The NORMALISED address is what gets sent and what the code screen
    // echoes, so the account signed into is the one the user will see. A
    // pasted " Jane@Example.com " would otherwise create a different account
    // from the one they already have.
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return;

    setIsSubmitting(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: address });
    setIsSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEmail(address);
    setStep('code');
  }

  // Takes the code as an argument rather than reading state, because
  // auto-submit fires from onFilled with the value that just completed the
  // field -- reading `code` there would see the previous render's value and
  // verify five digits.
  async function handleVerifyCode(submitted: string = code) {
    if (submitted.length !== 6 || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: submitted,
      type: 'email',
    });
    setIsSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Nothing to do with the session here, and no dismissal either -- the
    // effect above owns that. What this DOES handle is the case that used to
    // fall through silently: no error and no session, where the screen simply
    // sat there looking like the button hadn't been pressed.
    if (!data.session) {
      setError('That code was accepted but no session came back. Try again.');
    }
  }

  async function handleGoogleSignIn() {
    setIsSubmitting(true);
    setError(null);
    try {
      // Dismissal is the session effect's job, not this call's. The other two
      // outcomes ('cancel', 'dismiss') mean the user backed out of the browser
      // themselves, which is not an error and deserves no message.
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message ?? 'Google sign-in failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND[scheme] }}>
      {/* SettingsHeader rather than a hand-rolled row, so this sheet's title
          sits at the same left edge and weight as Settings and Manage
          Account. The header was the last thing on this screen still drawing
          its own chrome. */}
      <SettingsHeader
        title="Sync Account"
        icon={UserRound}
        right={
          <Pressable onPress={dismiss} className="p-1.5 rounded-full active:bg-muted">
            <Icon as={X} className="text-muted-foreground w-5 h-5" />
          </Pressable>
        }
      />

      <VStack className="flex-1 px-6 pt-4 gap-4">
        {step === 'email' && (
          <>
            <RNText className="text-sm text-muted-foreground">
              Enter your email to get your one-time code.
            </RNText>
            <Input className="rounded-lg h-11 px-3">
              <InputField
                value={email}
                onChangeText={setEmail}
                placeholder="janedoe@email.com"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                className="text-sm"
              />
            </Input>
            <Pressable
              onPress={handleSendCode}
              disabled={isSubmitting || !emailIsValid}
              className="py-3 rounded-lg bg-lime-500 items-center active:bg-lime-600 disabled:opacity-50"
            >
              {isSubmitting ? (
                <ActivityIndicator color="white" />
              ) : (
                <RNText className="text-sm font-semibold text-white">Send Code</RNText>
              )}
            </Pressable>

            <HStack className="items-center gap-3 my-2">
              <VStack className="flex-1 h-px bg-muted" />
              <RNText className="text-xs text-muted-foreground">or</RNText>
              <VStack className="flex-1 h-px bg-muted" />
            </HStack>

            <Pressable
              onPress={handleGoogleSignIn}
              disabled={isSubmitting}
              className="py-3 rounded-lg border border-border items-center active:bg-secondary disabled:opacity-50"
            >
              <RNText className="text-sm font-semibold text-foreground">Continue with Google</RNText>
            </Pressable>
          </>
        )}

        {step === 'code' && (
          <>
            <RNText className="text-sm text-muted-foreground">
              Enter the 6-digit code we sent to {email}.
            </RNText>
            {/* One box per digit. Beyond looking right, this fixes a real
                bug: the old single field gated its button on the RAW string
                length, so a code pasted as "123 456" was seven characters and
                the button stayed dead with nothing explaining why. Boxes
                normalise on the way in, so that cannot happen. */}
            <OtpInput
              numberOfDigits={6}
              autoFocus
              focusColor={OTP_FOCUS}
              // What makes iOS offer the code straight from the notification
              // banner and Android autofill it. Neither hint was set before,
              // so the code always had to be memorised or copied by hand.
              textInputProps={{
                autoComplete: 'one-time-code',
                textContentType: 'oneTimeCode',
                accessibilityLabel: 'Six-digit sign-in code',
              }}
              onTextChange={setCode}
              // Fires on the sixth digit, so the common case needs no Verify
              // tap at all. The button below stays for the retry after a wrong
              // code, when the field is already full and nothing new is typed.
              onFilled={(filled) => void handleVerifyCode(filled)}
              theme={{
                pinCodeContainerStyle: {
                  borderColor: OTP_BORDER[scheme],
                  backgroundColor: 'transparent',
                  borderWidth: 1,
                  borderRadius: 12,
                  width: 46,
                  height: 52,
                },
                pinCodeTextStyle: { color: OTP_TEXT[scheme], fontSize: 20, fontWeight: '600' },
                focusStickStyle: { backgroundColor: OTP_FOCUS },
              }}
            />
            <Pressable
              onPress={() => void handleVerifyCode()}
              disabled={isSubmitting || code.length !== 6}
              className="py-3 rounded-lg bg-lime-500 items-center active:bg-lime-600 disabled:opacity-50"
            >
              {isSubmitting ? (
                <ActivityIndicator color="white" />
              ) : (
                <RNText className="text-sm font-semibold text-white">Verify</RNText>
              )}
            </Pressable>
            <Pressable onPress={() => setStep('email')} className="items-center py-2">
              <RNText className="text-xs text-muted-foreground">Use a different email</RNText>
            </Pressable>
          </>
        )}

        {error && <RNText className="text-xs text-destructive">{error}</RNText>}
      </VStack>
    </SafeAreaView>
  );
}
