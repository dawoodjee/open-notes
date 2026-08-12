import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Text as RNText } from 'react-native';
import {
  Modal,
  ModalBackdrop,
  ModalContent,
  ModalHeader,
  ModalBody,
} from '@/components/ui/modal';
import { Pressable } from '@/components/ui/pressable';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { X, LogOut, UserRound } from 'lucide-react-native';

import AccountField, { FieldTone } from '@/components/AccountField';
import { SettingsGroup, SettingsRow } from '@/components/ui/settings-group';

import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/lib/auth/useProfile';
import { supabase } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/auth/withTimeout';
import {
  checkUsernameAvailable,
  formatRateLimitRemaining,
  sanitizeUsername,
  suggestAvailableUsername,
} from '@/lib/auth/username';
import { getPendingWriteCount, getPendingWrites, logout } from '@/lib/auth/logout';
import {
  IdentitySummary,
  canUnlink,
  linkGoogle,
  listIdentities,
  unlinkIdentity,
} from '@/lib/auth/identities';


/**
 * The trailing control on a sign-in-method row.
 *
 * One component for both states on purpose. They used to be two separately
 * written Pressables -- Link carried `border border-border` and Remove did
 * not -- so the same slot changed width and optical weight depending on
 * whether the account happened to be linked, and the right edge moved with it.
 * Since exactly one of them is ever on screen, that difference was invisible
 * in review and obvious in use.
 *
 * min-w is what actually holds the edge still: "Link" is four characters and
 * "Remove" is six, so equal padding alone would still give two widths.
 */
function IdentityAction({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="px-3.5 py-1.5 rounded-full bg-secondary min-w-[84px] items-center active:opacity-60 disabled:opacity-40"
    >
      <RNText
        className={`text-sm font-medium ${destructive ? 'text-destructive' : 'text-foreground'}`}
      >
        {label}
      </RNText>
    </Pressable>
  );
}

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

  // This component mounts as soon as login happens (AvatarMenuTrigger renders
  // it whenever isLoggedIn is true, not only while open), so a fetch at mount
  // can land before the profile row exists or before a sign-in has finished
  // populating it. Refetching on every open, rather than once at mount, means
  // the fields always reflect the account as it is right now.
  useEffect(() => {
    if (isOpen) refetch();
  }, [isOpen, refetch]);

  const [identities, setIdentities] = useState<IdentitySummary[] | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const loadIdentities = React.useCallback(async () => {
    setIdentityError(null);
    try {
      setIdentities(await listIdentities());
    } catch (err: any) {
      setIdentities(null);
      setIdentityError(err?.message ?? 'Could not load linked accounts');
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadIdentities();
  }, [isOpen, loadIdentities]);

  const googleIdentity = identities?.find((i) => i.provider === 'google') ?? null;

  async function handleLinkGoogle() {
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const result = await linkGoogle();
      if (result === 'success') await loadIdentities();
    } catch (err: any) {
      setIdentityError(err?.message ?? 'Could not link that account');
    } finally {
      setIdentityBusy(false);
    }
  }

  // No confirmation dialog, unlike signing out with unsynced notes. The two
  // look similar but aren't: removing a sign-in method is recoverable (link
  // it again), and the one case that genuinely isn't -- removing the last way
  // into the account -- is refused server-side and disabled here before the
  // tap. Unsynced notes, by contrast, are gone for good.
  async function handleRemoveGoogle() {
    if (!googleIdentity) return;
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      await unlinkIdentity(googleIdentity);
      await loadIdentities();
    } catch (err: any) {
      setIdentityError(err?.message ?? 'Could not remove that account');
    } finally {
      setIdentityBusy(false);
    }
  }

  // The values last taken from the server, so we can tell "the user hasn't
  // touched this box" from "the user typed something that happens to differ".
  const seededRef = React.useRef<{ username: string; fullName: string } | null>(null);

  // Seed straight from the profile, with no invented suggestion. An unset
  // username stays visibly empty so its placeholder shows and typing a full
  // name can fill it (see handleFullNameChange). Pre-filling here instead
  // would mean the username box is never empty, and that auto-fill could
  // never fire.
  //
  // Each field is only overwritten if it still holds exactly what was last
  // seeded -- i.e. the user hasn't edited it. Seeding unconditionally looks
  // harmless and isn't: saving the username calls refetch(), which produces a
  // new profile object, which re-ran this effect and wiped a full name that
  // had been typed but not yet saved. Observed exactly that -- username
  // saved, full name silently discarded.
  useEffect(() => {
    if (!profile || !session) return;
    const nextUsername = profile.username ?? '';
    const nextFullName = profile.full_name ?? '';
    const seeded = seededRef.current;

    if (!seeded || username === seeded.username) {
      setUsername(nextUsername);
      setUsernameEdited(false);
    }
    if (!seeded || fullName === seeded.fullName) {
      setFullName(nextFullName);
    }

    seededRef.current = { username: nextUsername, fullName: nextFullName };
  }, [profile, session]);

  // Whether the user has typed in the username box themselves. Once they
  // have, the full name stops driving it -- their choice wins.
  const [usernameEdited, setUsernameEdited] = useState(false);

  // Typing a full name fills in the username underneath, and keeps following
  // it keystroke by keystroke until either the account already has a username
  // or the user edits the username box directly.
  //
  // Gating on "username is empty" instead looks equivalent and isn't: the
  // first few characters of a name already sanitize to something non-empty,
  // so the field stops being empty immediately and the suggestion freezes
  // half-typed ("Adam D" -> adam_d, then stuck there no matter what you type
  // next). Tracking intent rather than emptiness is what makes it follow
  // along properly.
  //
  // Sanitized rather than copied: full_name is free text (any script, spaces,
  // punctuation) while username has a strict charset, so the raw value would
  // usually be invalid. Availability is still checked and the unique
  // constraint is still authoritative -- this only saves typing.
  function handleFullNameChange(text: string) {
    setFullName(text);
    if (profile?.username || usernameEdited) return;
    setUsername(sanitizeUsername(text.replace(/\s+/g, '_')));
  }

  function handleUsernameChange(text: string) {
    setUsernameEdited(true);
    setUsername(sanitizeUsername(text));
  }

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

  // One status line per field, derived rather than rendered inline, so every
  // field's message occupies the same fixed slot (see AccountField) and the
  // layout can't shift as messages appear.
  const usernameStatusText = (() => {
    if (usernameStatus === 'checking') return 'Checking availability…';
    if (usernameStatus === 'available') return 'Available';
    if (usernameStatus === 'taken') return usernameError ?? 'That username is taken.';
    if (usernameStatus === 'error') return usernameError ?? '';
    if (usernameStatus === 'saving') return 'Saving…';
    if (usernameStatus === 'saved') return 'Saved';
    return rateLimitMessage;
  })();

  const usernameStatusTone: FieldTone =
    usernameStatus === 'available' || usernameStatus === 'saved'
      ? 'ok'
      : usernameStatus === 'taken' || usernameStatus === 'error'
        ? 'error'
        : 'neutral';

  // --- Email ---------------------------------------------------------------
  // The field and its commit button are real; the change itself is not wired
  // up yet (see handleCommitEmail). Availability deliberately isn't checked
  // as you type the way username's is: there's no public endpoint to ask
  // whether an address is registered, and adding one would let anyone probe
  // who has an account. So the button can only reflect "this looks like a
  // valid address" -- "already in use" is something only the server can tell
  // us, on submit.
  const [email, setEmail] = useState('');
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  useEffect(() => {
    setEmail(session?.user.email ?? '');
    setEmailNotice(null);
  }, [session?.user.email, isOpen]);

  const emailDirty = email.trim() !== (session?.user.email ?? '');
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const emailStatus = emailNotice ?? (emailDirty && !emailLooksValid ? 'Enter a valid email address.' : '');
  const emailStatusTone: FieldTone = emailNotice || (emailDirty && !emailLooksValid) ? 'error' : 'neutral';

  // --- Seeding from a linked account --------------------------------------
  // An account created purely through Google has no profile row content of its
  // own -- Supabase stores the provider's name and address on the *identity*,
  // not in public.profiles. So when a field is still unset, take it from the
  // first linked identity rather than making the user retype what Google
  // already told us. Full name seeds the username underneath it too, the same
  // cascade as typing a name by hand.
  //
  // Only ever fills blanks: a value already on the profile always wins, since
  // the user chose it and the provider didn't.
  //
  // Signup only. An account that already has a username has been through
  // setup, and from then on Postgres is the only source for these fields --
  // the provider must never write over them again, however empty they look.
  //
  // That isn't just tidiness, because of what the cascade would do next. A
  // seeded full name flows into the username box, and committing a username
  // sets username_changed_at (see enforce_username_change_limit in the
  // migration) -- which starts the 30-day clock. The first set is allowed but
  // it *is* the change that begins the window. So re-seeding an existing
  // account risks spending someone's one change a month on a name Google
  // picked rather than one they chose.
  //
  // "Has a username" is the test rather than "has a full name": username is
  // mandatory at signup and full_name isn't, so an account can legitimately
  // sit with a blank name forever and must not be re-seeded every time this
  // sheet opens.
  const isUnsetUpAccount = !!profile && !profile.username;
  const identitySeededRef = React.useRef(false);

  useEffect(() => {
    if (!isOpen) {
      identitySeededRef.current = false;
      return;
    }
    if (identitySeededRef.current) return;
    if (!identities || identities.length === 0 || !profile) return;
    if (!isUnsetUpAccount) return;

    const source = identities.find((i) => i.fullName || i.email);
    if (!source) return;
    identitySeededRef.current = true;

    // The name and the username are seeded on separate conditions, because
    // setup can be interrupted halfway. The full name autosaves as you type;
    // the username doesn't (it needs the tick). So "typed a name, killed the
    // app, came back" leaves a saved name and no username -- and on reopening,
    // the name must NOT be overwritten by the provider's version, while the
    // username still needs suggesting. Gating both on the same condition gets
    // one of those two cases wrong whichever way you pick.
    if (!profile.full_name && source.fullName) {
      // Routed through the same handler as typing, so the username cascade
      // and the debounced autosave both happen exactly as they normally do.
      handleFullNameChange(source.fullName);
    }

    // Whatever name we now have -- theirs if they typed one, the provider's
    // otherwise -- turned into a username that's actually free. "Adam
    // Dawoodjee" sanitizes to adam_dawoodjee for everyone called that, so
    // without this the first thing a new user sees is their own name marked
    // "taken", with a grey tick and no hint about a value they never chose.
    const nameForUsername = profile.full_name || source.fullName;
    if (nameForUsername) {
      void suggestAvailableUsername(
        sanitizeUsername(nameForUsername.replace(/\s+/g, '_')),
        session?.user.id
      ).then((free) => {
        // Only if they haven't started typing in the meantime -- the check is
        // a network round-trip, and their choice always wins over ours.
        setUsername((current) => (usernameEdited ? current : free));
      });
    }
    if (!session?.user.email && source.email) {
      setEmail(source.email);
    }
  }, [isOpen, identities, profile, isUnsetUpAccount, session?.user.email]);

  // --- Required fields -----------------------------------------------------
  // All three must have a value before the sheet will close. The rejection is
  // shown by pulsing the offending field's border pink rather than adding a
  // message: the fields already reserve one status line each, and an error
  // string there would push the "Available"/rate-limit text out of the way.
  // Colour is a weak signal on its own, but this one is paired with the tap
  // visibly not working, which is the actual message.
  const [flash, setFlash] = useState(0);
  const missingFullName = fullName.trim().length === 0;
  const missingEmail = email.trim().length === 0;

  // Deliberately not just "the box is empty".
  //
  // A username only counts once it's been committed with the tick -- unlike
  // the full name, typing it saves nothing. And the box is rarely empty for a
  // new account anyway, because the full name auto-fills a suggestion into
  // it. Testing the text alone would let someone leave setup with a plausible
  // username on screen and NULL in the database, which is the exact state
  // this guard exists to prevent.
  //
  // So: the account must have a stored username, and the box must not have
  // since been cleared. An uncommitted *edit* by someone who already has one
  // doesn't block closing -- it's just discarded, and they still have the
  // username they arrived with.
  const missingUsername = !profile?.username || username.trim().length === 0;
  const hasEmptyField = missingFullName || missingUsername || missingEmail;

  function handleAttemptClose() {
    // Signing out is the deliberate exception -- see handleSignOut, which
    // closes directly. Someone leaving the account shouldn't be held hostage
    // by a profile they're abandoning anyway.
    if (hasEmptyField) {
      setFlash((n) => n + 1);
      return;
    }
    onClose();
  }

  function handleCommitEmail() {
    // Deliberately says so out loud rather than doing nothing. A control that
    // silently fails reads as broken -- exactly how the Link button looked
    // before manual linking was enabled.
    setEmailNotice("Changing your email isn't available yet.");
  }

  function saveFullNameIfChanged() {
    if (!fullNameDirty) return;
    void saveFullName();
  }

  // Debounced autosave, because onBlur alone loses data. Moving focus from
  // the full-name field straight onto a button (Set username, Log Out) does
  // not reliably fire onBlur in React Native, so the typed name was silently
  // discarded -- observed exactly that: username saved, full name gone.
  //
  // Safe to autosave here in a way it wouldn't be for username: full_name is
  // free text with no uniqueness and no 30-day rate limit, so writing it
  // repeatedly costs nothing and can't be rejected. Same 300ms debounce the
  // note editor already uses for its own writes.
  useEffect(() => {
    if (!fullNameDirty) return;
    const timeout = setTimeout(() => void saveFullName(), 300);
    return () => clearTimeout(timeout);
  }, [fullName, fullNameDirty]);

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
    // Full-bleed sheet: full width, anchored to the bottom edge, 4/5 of the
    // screen tall, square bottom corners so it reads as attached to the
    // screen rather than floating. mt-auto is what pushes it down inside the
    // modal's centering container. ROUNDED_LG is shared with every button
    // below so the sheet and its controls agree on one radius.
    // The pb-* below is the gap under the Log Out button -- the sheet's bottom
    // padding is what sits beneath the pinned button, so that one value is the
    // button's height off the bottom edge.
    <Modal isOpen={isOpen} onClose={handleAttemptClose} size="full">
      <ModalBackdrop />
      <ModalContent className="w-full max-w-full h-4/5 mt-auto mb-0 mx-0 rounded-t-2xl rounded-b-none border-0 px-5 pb-13">
        <ModalHeader>
          <HStack className="items-center">
            <Icon as={UserRound} className="w-5 h-5 mr-2 text-muted-foreground" />
            <RNText className="text-base font-semibold text-foreground">Manage Account</RNText>
          </HStack>
          {/* A plain Pressable, not ModalCloseButton: that one closes through
              the modal's own context and would bypass the required-field
              check, so the X and the backdrop would disagree. */}
          <Pressable onPress={handleAttemptClose} className="p-1 -mr-1">
            <Icon as={X} className="text-muted-foreground w-5 h-5" />
          </Pressable>
        </ModalHeader>

        {/* flex-1 is what lets the Log Out button's mt-auto push it to the
            bottom of the sheet instead of sitting directly under the last
            row with dead space beneath it. */}
        {/* Note that gap-3 here does NOT space these children apart, however
            much it looks like it should: ModalBody is a ScrollView, NativeWind
            maps className to the component's own style, and a ScrollView lays
            its children out in an internal content container rather than in
            itself. The spacing you see comes from the VStacks below. Left in
            place only because pt/pb do apply. */}
        <ModalBody className="flex-1 gap-3 pt-4 pb-6">
          {profileError && (
            <HStack className="items-center justify-between bg-red-50 rounded-2xl px-4 py-3">
              <RNText className="text-xs text-destructive flex-1 pr-2">
                Couldn't load your profile: {profileError}
              </RNText>
              <Pressable onPress={refetch} className="py-1.5 px-3 rounded-xl bg-red-100">
                <RNText className="text-xs font-medium text-destructive">Retry</RNText>
              </Pressable>
            </HStack>
          )}
          {/* One group per field: input + its status line, uniform spacing
              inside, uniform spacing between. Full name leads -- it's the
              human-facing one, and typing it fills the username below, so the
              order matches the flow. */}
          <VStack className="gap-3">
            {/* No status line: full name autosaves, has no validation and
                nothing to be unavailable, so a "Saved" flag would be noise. */}
            <AccountField
              value={fullName}
              onChangeText={handleFullNameChange}
              placeholder="Full name"
              flash={missingFullName ? flash : 0}
            />

            <AccountField
              value={username}
              onChangeText={handleUsernameChange}
              placeholder="Username"
              autoCapitalize="none"
              showAction={usernameDirty}
              canCommit={usernameStatus === 'available' || usernameStatus === 'saved'}
              onCommit={saveUsername}
              status={usernameStatusText}
              statusTone={usernameStatusTone}
              flash={missingUsername ? flash : 0}
            />

            <AccountField
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              showAction={emailDirty}
              canCommit={emailLooksValid}
              onCommit={handleCommitEmail}
              status={emailStatus}
              statusTone={emailStatusTone}
              flash={missingEmail ? flash : 0}
            />
          </VStack>

          {/* No rule between the fields and the sign-in methods: the change in
              row shape already separates them, and a line made the sheet look
              busier without telling you anything the layout doesn't. */}

          {/* Email sign-in isn't listed. It's always available and can't be
              turned off, so a row for it would be inert -- and the address it
              applies to is already shown directly above. */}
          {/* Built on the settings primitives rather than hand-rolled rows,
              which is what fixes the alignment: every label sits in the same
              flex-1 column at the card's px-4, so it lands at the same left
              edge as the field text above (both are 16px inside a full-width
              container). Before this, the labels sat at the sheet's own edge
              and the field text 16px further in -- two left edges stacked
              vertically, with the footnote making a third.

              Secondary text stays at px-1, deliberately NOT aligned to the row
              labels. That inset is the iOS grouped-list convention and it is
              what settings-group already does everywhere else; matching it is
              the point of moving here. */}
          <SettingsGroup
            caption="Sign-in methods"
            footnote={
              /* Explains a disabled Remove rather than leaving it inert and
                 unexplained -- a greyed-out button with no reason is worse
                 than the rejection it's preventing.

                 Careful with the wording: this is NOT "your only way to sign
                 in". An account created through Google has its email set, and
                 email OTP works on it immediately -- verified against the
                 local stack. The limit is narrower than that and belongs to
                 Supabase: it counts rows in auth.identities and refuses to
                 drop the last one ("User must have at least 1 identity after
                 unlinking", 422). Signing in by OTP doesn't add an email
                 identity, so an OAuth-only account stays at exactly one however
                 many times you use email. Saying "only sign-in method" would
                 tell the user something false about their own account. */
              googleIdentity && identities !== null && !canUnlink(identities)
                ? 'This is your only linked account. Link another before removing it.'
                : undefined
            }
          >
            <SettingsRow
              label="Google"
              sublabel={googleIdentity?.email ?? undefined}
              right={
                identities === null ? (
                  <RNText className="text-sm text-muted-foreground">…</RNText>
                ) : googleIdentity ? (
                  <IdentityAction
                    label="Remove"
                    destructive
                    onPress={handleRemoveGoogle}
                    disabled={identityBusy || !canUnlink(identities)}
                  />
                ) : (
                  <IdentityAction
                    label="Link"
                    onPress={handleLinkGoogle}
                    disabled={identityBusy}
                  />
                )
              }
            />

            {/* Email sign-in isn't listed. It's always available and can't be
                turned off, so a row for it would be inert -- and the address it
                applies to is already shown directly above. */}
            <SettingsRow label="Apple" value="Not available" disabled />
          </SettingsGroup>

          {identityError && (
            <RNText className="text-xs text-destructive px-1 -mt-4 mb-4">{identityError}</RNText>
          )}

        </ModalBody>

        {/* Deliberately outside ModalBody. ModalBody is a ScrollView, and a
            child's mt-auto can't stretch inside one -- the button ended up
            floating directly under the last row with dead space beneath it.
            Sitting here instead, as a sibling of the scroll area, pins it to
            the bottom of the sheet whatever the content height.

            Primary button shape (solid fill, same radius as the sheet and
            every other control) in a warning colour -- it reads as the main
            action without pretending to be a safe one. */}
        <Pressable
          onPress={handleSignOut}
          className="w-4/5 self-center py-3.5 rounded-2xl bg-red-500 flex-row items-center justify-center gap-2 active:bg-red-700"
        >
          <Icon as={LogOut} className="text-white w-4 h-4" />
          <RNText className="text-base font-semibold text-white">Log Out</RNText>
        </Pressable>
      </ModalContent>
    </Modal>
  );
}
