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

type Step = 'email' | 'code';

// Reached only by tapping "Enable Sync" in the avatar menu -- never shown
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

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // Nothing to do with the session here. AuthContext's onAuthStateChange
    // picks up this same SIGNED_IN event and routes it through
    // becomeAuthenticatedLocally, which is the single path into authenticated
    // local state -- this screen just gets out of the way.
    if (data.session) router.back();
  }

  async function handleGoogleSignIn() {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      if (result === 'success') router.back();
    } catch (err: any) {
      setError(err.message ?? 'Google sign-in failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <HStack className="justify-between items-center px-4 py-3">
        <RNText className="text-lg font-semibold text-gray-900">Enable Sync</RNText>
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
              <RNText className="text-sm font-semibold text-gray-800">Continue with Google</RNText>
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

        {error && <RNText className="text-xs text-red-500">{error}</RNText>}
      </VStack>
    </SafeAreaView>
  );
}
