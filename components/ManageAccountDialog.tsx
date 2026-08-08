import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Text as RNText } from 'react-native';
import {
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
} from '@/components/ui/modal';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Check, X, LogOut } from 'lucide-react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/lib/auth/useProfile';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/auth/withTimeout';
import {
  checkUsernameAvailable,
  formatRateLimitRemaining,
  sanitizeUsername,
  suggestUsername,
} from '@/lib/auth/username';
import { getPendingWriteCount, getPendingWrites, logout } from '@/lib/auth/logout';

export interface ManageAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type FieldStatus = 'idle' | 'checking' | 'available' | 'taken' | 'saving' | 'saved' | 'error';

export default function ManageAccountDialog({ isOpen, onClose }: ManageAccountDialogProps) {
  const { session } = useAuth();
  const { profile, isLoading, error: profileError, refetch } = useProfile();

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<FieldStatus>('idle');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [fullNameStatus, setFullNameStatus] = useState<FieldStatus>('idle');

  // This component mounts as soon as login happens (AvatarMenuTrigger
  // renders it whenever isLoggedIn is true, not only while open), which can
  // race ahead of the post-signup username prompt in app/enable-sync.tsx --
  // both fire off the same SIGNED_IN event. Refetching on every open (not
  // just once at mount) means the fields never show a stale pre-prompt
  // snapshot from that race.
  useEffect(() => {
    if (isOpen) refetch();
  }, [isOpen, refetch]);

  // Seed fields from the loaded profile. If username is still unset,
  // pre-fill (not auto-submit) a suggestion: sanitized full_name if one
  // already arrived from OAuth, else the existing email-local-part fallback.
  useEffect(() => {
    if (!profile || !session) return;
    setFullName(profile.full_name ?? '');
    if (profile.username) {
      setUsername(profile.username);
    } else {
      setUsername(suggestUsername(profile.full_name, session.user.email ?? ''));
    }
  }, [profile, session]);

  const usernameDirty = profile ? username !== (profile.username ?? '') : false;
  const fullNameDirty = profile ? fullName !== (profile.full_name ?? '') : false;

  // Live availability check as you type -- UX only. The unique-violation
  // error on the actual save is what's authoritative (Stage 4 found this
  // pre-check can race two concurrent same-name attempts).
  useEffect(() => {
    if (!usernameDirty || username.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const timeout = setTimeout(async () => {
      const available = await checkUsernameAvailable(username, session?.user.id);
      setUsernameStatus(available ? 'available' : 'taken');
    }, 400);
    return () => clearTimeout(timeout);
  }, [username, usernameDirty]);

  const rateLimitMessage = useMemo(() => {
    if (!profile?.username_changed_at) return '';
    return formatRateLimitRemaining(profile.username_changed_at);
  }, [profile?.username_changed_at]);

  async function saveUsername() {
    if (!session) return;
    setUsernameStatus('saving');
    setUsernameError(null);
    const { error } = await withTimeout(
      supabase.from('profiles').update({ username }).eq('id', session.user.id),
      8000,
      'Saving username'
    ).catch((err) => ({ error: err }));

    if (error) {
      if (error.code === '23505') {
        setUsernameStatus('taken');
        setUsernameError('That username is already taken.');
      } else if (error.message?.includes('once every 30 days')) {
        setUsernameStatus('error');
        setUsernameError(rateLimitMessage || 'You can only change your username once every 30 days.');
      } else {
        setUsernameStatus('error');
        setUsernameError(error.message);
      }
      return;
    }
    setUsernameStatus('saved');
    await refetch();
  }

  async function saveFullName() {
    if (!session) return;
    setFullNameStatus('saving');
    const { error } = await withTimeout(
      supabase.from('profiles').update({ full_name: fullName.trim() || null }).eq('id', session.user.id),
      8000,
      'Saving full name'
    ).catch((err) => ({ error: err }));
    setFullNameStatus(error ? 'error' : 'saved');
    if (!error) await refetch();
  }

  async function handleSignOut() {
    // The COUNT is what decides whether to warn -- not the parsed list.
    // Those are different questions: "is there anything unsynced" is a plain
    // row count that cannot be got wrong, while "what are the notes called"
    // depends on parsing PowerSync's internal CrudEntry JSON. Gating on the
    // parsed list meant a parsing miss read as "nothing to lose" and wiped
    // local data with no warning at all, which is exactly the outcome this
    // dialog exists to prevent. Names are now decoration on the warning;
    // the count alone decides whether the user is asked.
    const pendingCount = await getPendingWriteCount();
    if (pendingCount === 0) {
      await logout();
      onClose();
      return;
    }

    const pending = await getPendingWrites();
    const names = pending.length > 0 ? pending.map((p) => `"${p.title}"`).join(', ') : null;
    Alert.alert(
      'You have unsynced changes',
      names
        ? `${pending.length === 1 ? "This note hasn't" : "These notes haven't"} finished syncing yet and will be lost if you log out now: ${names}`
        : `You have ${pendingCount} unsynced ${pendingCount === 1 ? 'change' : 'changes'} that will be lost if you log out now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out Anyway',
          style: 'destructive',
          onPress: async () => {
            await logout();
            onClose();
          },
        },
      ]
    );
  }

  if (!session) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalBackdrop />
      <ModalContent>
        <ModalHeader>
          <RNText className="text-base font-semibold text-gray-900">Manage Account</RNText>
          <ModalCloseButton>
            <Icon as={X} className="text-gray-400 w-5 h-5" />
          </ModalCloseButton>
        </ModalHeader>

        <ModalBody className="gap-4 pb-4">
          {profileError && (
            <HStack className="items-center justify-between bg-red-50 rounded-lg px-3 py-2.5">
              <RNText className="text-xs text-red-600 flex-1 pr-2">
                Couldn't load your profile: {profileError}
              </RNText>
              <Pressable onPress={refetch} className="py-1 px-2.5 rounded-md bg-red-100">
                <RNText className="text-xs font-medium text-red-700">Retry</RNText>
              </Pressable>
            </HStack>
          )}
          <VStack className="gap-1.5">
            <RNText className="text-xs font-semibold text-gray-500 uppercase">Username</RNText>
            <HStack className="items-center gap-2">
              <Input className="flex-1 rounded-lg h-10 px-3">
                <InputField
                  value={username}
                  onChangeText={(t) => setUsername(sanitizeUsername(t))}
                  placeholder="username"
                  autoCapitalize="none"
                  className="text-sm"
                />
              </Input>
              {usernameDirty && usernameStatus !== 'checking' && (
                <Pressable
                  onPress={saveUsername}
                  disabled={usernameStatus === 'taken'}
                  className="w-9 h-9 rounded-lg items-center justify-center bg-lime-500 active:bg-lime-600"
                >
                  <Icon as={Check} className="text-white w-4 h-4" />
                </Pressable>
              )}
            </HStack>
            {usernameStatus === 'checking' && (
              <RNText className="text-xs text-gray-400">Checking availability…</RNText>
            )}
            {usernameStatus === 'available' && (
              <RNText className="text-xs text-green-600">Available</RNText>
            )}
            {usernameStatus === 'taken' && (
              <RNText className="text-xs text-red-500">
                {usernameError ?? 'That username is taken.'}
              </RNText>
            )}
            {usernameStatus === 'error' && (
              <RNText className="text-xs text-red-500">{usernameError}</RNText>
            )}
            {usernameStatus === 'saved' && (
              <RNText className="text-xs text-green-600">Saved.</RNText>
            )}
            {usernameStatus === 'idle' && rateLimitMessage !== '' && (
              <RNText className="text-xs text-gray-400">{rateLimitMessage}</RNText>
            )}
          </VStack>

          <VStack className="gap-1.5">
            <RNText className="text-xs font-semibold text-gray-500 uppercase">Full Name</RNText>
            <HStack className="items-center gap-2">
              <Input className="flex-1 rounded-lg h-10 px-3">
                <InputField
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  className="text-sm"
                />
              </Input>
              {fullNameDirty && (
                <Pressable
                  onPress={saveFullName}
                  className="w-9 h-9 rounded-lg items-center justify-center bg-lime-500 active:bg-lime-600"
                >
                  <Icon as={Check} className="text-white w-4 h-4" />
                </Pressable>
              )}
            </HStack>
            {fullNameStatus === 'saved' && (
              <RNText className="text-xs text-green-600">Saved.</RNText>
            )}
          </VStack>

          <VStack className="gap-1.5">
            <RNText className="text-xs font-semibold text-gray-500 uppercase">Email</RNText>
            <RNText className="text-sm text-gray-500">{session.user.email}</RNText>
          </VStack>

          <Pressable
            onPress={handleSignOut}
            className="mt-2 py-2.5 rounded-lg bg-red-50 flex-row items-center justify-center gap-2 active:bg-red-100"
          >
            <Icon as={LogOut} className="text-red-600 w-4 h-4" />
            <RNText className="text-sm font-medium text-red-600">Sign Out</RNText>
          </Pressable>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
