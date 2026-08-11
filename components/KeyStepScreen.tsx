import React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';

/**
 * Shared chrome for the two screens that can block the whole app after
 * sign-in: SecureAccountScreen (save a recovery code) and AdoptKeyScreen
 * (enter one). Both sit above the note UI with sync deliberately
 * disconnected, so until the user finishes -- or leaves -- nothing else in
 * the app is reachable.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED. The two screens used to disagree
 * about how you leave: adoption offered a "Sign out instead" text link, and
 * key setup offered nothing at all, so the only way off it was force-quitting
 * the app. Two screens with the same job and the same blocking behaviour
 * should not have two different answers to "how do I get out of this", and
 * the reliable way to keep them the same is to give them one implementation
 * rather than two that currently match.
 *
 * The X and its padding are lifted from app/enable-sync.tsx's header on
 * purpose. That sheet is where the user was moments earlier, so reusing its
 * exact close control means the gesture they just learned still works.
 */
export function KeyStepScreen({
  onCancel,
  cancelDisabled,
  children,
}: {
  onCancel: () => void;
  /**
   * Set while the step is committing. Not cosmetic -- see the call sites:
   * completing either step runs irreversible key work (uploading the account
   * key, or adopting one and re-encrypting every local note), and a sign-out
   * landing in the middle of that is the one genuinely damaging thing a stray
   * tap here could do.
   */
  cancelDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    // style={{ flex: 1 }}, NOT className="flex-1". NativeWind's className does
    // not reach this component -- it is react-native-safe-area-context's, not
    // a styled primitive -- so the class is silently dropped, the container
    // gets no flex, and `justify-center` inside it centres against zero
    // height: the headline and the code scroll off the top of the screen while
    // the button still shows. Caught on the Pixel, not in review. Every other
    // SafeAreaView here does the same thing (NotesLayout, enable-sync).
    //
    // edges={['top']} matters too: KeyStepOverlay renders this inside an
    // `absolute inset-0` View (app/_layout.tsx), which is full-bleed under the
    // notch. The bodies below don't care because they're vertically centred,
    // but an X pinned to the top would sit under the status bar without this.
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <HStack className="justify-end px-4 py-3">
        <Pressable
          onPress={onCancel}
          disabled={cancelDisabled}
          className="p-1.5 rounded-full active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Sign out and leave setup"
        >
          <Icon as={X} className="text-muted-foreground w-5 h-5" />
        </Pressable>
      </HStack>

      {/* The centring wrapper lives here rather than in each screen -- it was
          copy-pasted in three places before this. */}
      <View className="flex-1 justify-center px-8">{children}</View>
    </SafeAreaView>
  );
}

/**
 * The confirmation behind the X, shared so the title and the button labels
 * cannot drift apart between the two screens.
 *
 * `message` is per-screen because the consequence genuinely differs -- one
 * abandons setting sync up, the other abandons reading an existing account's
 * notes here -- and a single sentence vague enough to cover both would tell
 * the user less than either specific one.
 *
 * Alert.alert rather than a custom dialog: it's what the other destructive
 * confirmations in this codebase already use (see EndpointsView's endpoint
 * removal and ManageAccountDialog's unsynced-changes logout), and it renders
 * above a full-screen overlay with no z-index reasoning required.
 */
export function confirmSignOut(message: string, onConfirm: () => void): void {
  Alert.alert('Sign out of this account?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign Out', style: 'destructive', onPress: onConfirm },
  ]);
}
