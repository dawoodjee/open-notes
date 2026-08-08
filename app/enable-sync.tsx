import React, { useState } from 'react';
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
import { checkUsernameAvailable, sanitizeUsername, suggestUsername } from '@/lib/auth/username';
import { withTimeout } from '@/lib/auth/withTimeout';

type Step = 'email' | 'code' | 'username';

// Reached only by tapping "Enable Sync" in the avatar menu -- never shown
// automatically on launch. Email OTP entry (two steps: request code, verify
// code) plus Google. Apple omitted for now -- no real credentials yet
// (Stage 4 left it disabled), and a dead button would be untested UI debt.
//
// A third, conditional step ("username") appears right after a successful
// sign-in IF this account has no username yet -- i.e. account creation, not
// every login. It's skippable (never blocks getting into the app) and
// reuses the same suggest/check/save flow the Manage Account dialog uses
// later for edits, so there's exactly one implementation of that logic.
export default function EnableSyncScreen() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

  async function maybePromptUsername(uid: string, userEmail: string | undefined) {
    try {
      const { data: profile } = await withTimeout(
        supabase.from('profiles').select('username, full_name').eq('id', uid).single(),
        8000,
        'Loading new profile'
      );

      if (profile && !profile.username) {
        setUserId(uid);
        setUsername(suggestUsername(profile.full_name, userEmail ?? ''));
        setStep('username');
        return;
      }
    } catch {
      // Couldn't check -- never block getting into the app over this, the
      // username prompt is a nice-to-have, not a gate.
    }
    router.back();
  }

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
    // AuthContext's onAuthStateChange also picks up this SIGNED_IN event and
    // routes it through becomeAuthenticatedLocally independently -- this
    // call is only about deciding whether to show the username step.
    if (data.session) await maybePromptUsername(data.session.user.id, data.session.user.email);
  }

  async function handleGoogleSignIn() {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      if (result === 'success') {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) await maybePromptUsername(session.user.id, session.user.email);
      }
    } catch (err: any) {
      setError(err.message ?? 'Google sign-in failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUsernameChange(text: string) {
    const sanitized = sanitizeUsername(text);
    setUsername(sanitized);
    setUsernameAvailable(null);
    if (sanitized.length >= 3) {
      const available = await checkUsernameAvailable(sanitized);
      setUsernameAvailable(available);
    }
  }

  async function handleSaveUsername() {
    if (!userId) return;
    setIsSubmitting(true);
    setError(null);
    // The unique-violation on this write is the real guarantee -- the
    // availability check above is UX only and can race, same as everywhere
    // else username is set.
    const { error } = await withTimeout(
      supabase.from('profiles').update({ username }).eq('id', userId),
      8000,
      'Saving username'
    ).catch((err) => ({ error: err }));
    setIsSubmitting(false);
    if (error) {
      setError(error.code === '23505' ? 'That username is already taken.' : error.message);
      return;
    }
    router.back();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <HStack className="justify-between items-center px-4 py-3">
        <RNText className="text-lg font-semibold text-gray-900">
          {step === 'username' ? 'Pick a Username' : 'Enable Sync'}
        </RNText>
        <Pressable onPress={() => router.back()} className="p-1.5 rounded-full active:bg-gray-100">
          <Icon as={X} className="text-gray-500 w-5 h-5" />
        </Pressable>
      </HStack>

      <VStack className="flex-1 px-6 pt-4 gap-4">
        {step === 'email' && (
          <>
            <RNText className="text-sm text-gray-500">
              Enter your email and we'll send you a one-time code — no password needed.
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
              <VStack className="flex-1 h-px bg-gray-200" />
              <RNText className="text-xs text-gray-400">or</RNText>
              <VStack className="flex-1 h-px bg-gray-200" />
            </HStack>

            <Pressable
              onPress={handleGoogleSignIn}
              disabled={isSubmitting}
              className="py-3 rounded-lg border border-gray-300 items-center active:bg-gray-50 disabled:opacity-50"
            >
              <RNText className="text-sm font-semibold text-gray-800">
                Continue with Google
              </RNText>
            </Pressable>
          </>
        )}

        {step === 'code' && (
          <>
            <RNText className="text-sm text-gray-500">
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
              <RNText className="text-xs text-gray-400">Use a different email</RNText>
            </Pressable>
          </>
        )}

        {step === 'username' && (
          <>
            <RNText className="text-sm text-gray-500">
              You're signed in. Pick a username — you can change this later.
            </RNText>
            <Input className="rounded-lg h-11 px-3">
              <InputField
                value={username}
                onChangeText={handleUsernameChange}
                placeholder="username"
                autoCapitalize="none"
                className="text-sm"
              />
            </Input>
            {usernameAvailable === false && (
              <RNText className="text-xs text-red-500">That username is taken.</RNText>
            )}
            {usernameAvailable === true && (
              <RNText className="text-xs text-green-600">Available</RNText>
            )}
            <Pressable
              onPress={handleSaveUsername}
              disabled={isSubmitting || username.length < 3 || usernameAvailable === false}
              className="py-3 rounded-lg bg-lime-500 items-center active:bg-lime-600 disabled:opacity-50"
            >
              {isSubmitting ? (
                <ActivityIndicator color="white" />
              ) : (
                <RNText className="text-sm font-semibold text-white">Save</RNText>
              )}
            </Pressable>
            <Pressable onPress={() => router.back()} className="items-center py-2">
              <RNText className="text-xs text-gray-400">Skip for now</RNText>
            </Pressable>
          </>
        )}

        {error && <RNText className="text-xs text-red-500">{error}</RNText>}
      </VStack>
    </SafeAreaView>
  );
}
