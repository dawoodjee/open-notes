import React, { useCallback, useEffect, useState } from 'react';
import { Text as RNText, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import { X } from 'lucide-react-native';

import { supabase } from '@/lib/supabase/client';
import { signInWithGoogle } from '@/lib/auth/oauth';
import { useAuth } from '@/contexts/AuthContext';
import { BACKGROUND, useTheme } from '@/contexts/ThemeContext';

type Step = 'email' | 'code';

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

  async function handleSendCode() {
    setIsSubmitting(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setIsSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep('code');
  }

  async function handleVerifyCode() {
    setIsSubmitting(true);
    setError(null);
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
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
      <HStack className="justify-between items-center px-4 py-3">
        <RNText className="text-lg font-semibold text-foreground">Manage Sync</RNText>
        <Pressable onPress={dismiss} className="p-1.5 rounded-full active:bg-muted">
          <Icon as={X} className="text-muted-foreground w-5 h-5" />
        </Pressable>
      </HStack>

      <VStack className="flex-1 px-6 pt-4 gap-4">
        {step === 'email' && (
          <>
            <RNText className="text-sm text-muted-foreground">
              Enter your email and we’ll send you a one-time code — no password needed.
            </RNText>
            <Input className="rounded-lg h-11 px-3">
              <InputField
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                className="text-sm"
              />
            </Input>
            <Pressable
              onPress={handleSendCode}
              disabled={isSubmitting || !email}
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
            <Input className="rounded-lg h-11 px-3">
              <InputField
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                className="text-sm"
              />
            </Input>
            <Pressable
              onPress={handleVerifyCode}
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
