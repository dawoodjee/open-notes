import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { KeyStepScreen } from '@/components/KeyStepScreen';
import {
  CURRENT_RECOVERY_FORMAT,
  RECOVERY_WORDS,
  isRecoveryWord,
  normalizeRecoveryCode,
  suggestRecoveryWords,
} from '@/lib/crypto/keys';

/**
 * The only moment the recovery code exists in readable form.
 *
 * It is not stored anywhere decryptable, is deliberately never emailed (an
 * inbox that can also receive a sign-in link would otherwise be a single point
 * of total compromise), and cannot be regenerated.
 *
 * Hence typing it back rather than a checkbox: "I saved it" is a box people
 * tick reflexively. Transcribing twelve words is weak proof, but it is proof.
 *
 * Lifted out of the old PinScreen so it could outlive it -- the recovery code
 * is about transporting the key to another device, which has nothing to do
 * with how this device unlocks.
 */
export function RecoveryCodeView({
  code,
  onConfirmed,
  onCancel,
  headline = 'Save your recovery code',
  blurb = 'This is the only way to read your notes on a new device. Write it down somewhere safe. We can’t show it again, and we can’t recover it for you.',
}: {
  code: string;
  onConfirmed: () => void | Promise<void>;
  /**
   * Required, deliberately. This screen blocks the entire app, and it shipped
   * with no way off it at all -- the only exit was force-quitting. A required
   * prop is what stops a future caller from reintroducing that: you cannot
   * mount this component without saying how someone leaves it.
   */
  onCancel: () => void;
  headline?: string;
  blurb?: string;
}) {
  const [step, setStep] = useState<'save' | 'verify'>('save');
  const [typed, setTyped] = useState<string[]>(() => Array(RECOVERY_WORDS).fill(''));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const words = useMemo(() => code.split('-'), [code]);

  // Compared through the SHARED normaliser rather than a local strip().
  // The old local version upper-cased and dropped punctuation but skipped the
  // format's own folding rules, so this screen could reject a transcription
  // that the restore screen would have accepted -- the two disagreed about
  // what "the same code" means, which is the one thing they must not.
  // CURRENT_RECOVERY_FORMAT, named rather than defaulted: this screen only
  // ever shows a code that was just issued, and issuing is the one place the
  // format is not a lookup. Both sides must normalise the same way or the
  // comparison is meaningless, so they read the one constant.
  const matches = useMemo(
    () =>
      normalizeRecoveryCode(typed.join(' '), CURRENT_RECOVERY_FORMAT) ===
      normalizeRecoveryCode(code, CURRENT_RECOVERY_FORMAT),
    [typed, code]
  );

  const filled = typed.filter((w) => w.trim().length > 0).length;

  async function handleCopy() {
    // Space-separated, not dashed. Both normalise to the same string, so both
    // unlock -- but a line of plain words reads as prose wherever it is pasted,
    // while the dashed form announces itself as a code to anything scanning a
    // clipboard or a synced note.
    await Clipboard.setStringAsync(words.join(' '));
    setCopied(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === 'save') {
    return (
      <KeyStepScreen onCancel={onCancel}>
        <Text className="text-xl font-semibold text-foreground mb-3">{headline}</Text>
        <Text className="text-sm text-muted-foreground mb-5">{blurb}</Text>

        {/* Numbered, three to a row. Twelve words wrapped as one paragraph is
            how people lose their place halfway through copying them out, and
            the numbers are what let someone check they have all twelve without
            recounting. */}
        <View className="bg-muted rounded-2xl p-4 mb-3 flex-row flex-wrap">
          {words.map((word, i) => (
            <View key={i} className="w-1/3 flex-row items-baseline py-1.5 pr-2">
              <Text className="text-[11px] text-muted-foreground w-5">{i + 1}</Text>
              <Text className="text-[15px] text-foreground font-medium">{word}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={handleCopy}
          className="h-10 items-center justify-center rounded-xl active:opacity-60 mb-1"
        >
          <Text className="text-sm font-medium text-foreground">
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>

        {/* Said plainly rather than buried. Copying is offered because writing
            twelve words by hand is where people give up -- but the clipboard is
            readable by other apps, and there is no honest way to promise
            otherwise, so the trade is stated instead of hidden. No auto-clear
            timer: it would look like protection while another app reads the
            clipboard in milliseconds. */}
        <Text className="text-xs text-muted-foreground text-center mb-5 leading-4">
          Anything you paste it into can read it, and so can other apps while it
          is on the clipboard. Paper is safer.
        </Text>

        <Pressable
          onPress={() => setStep('verify')}
          className="bg-primary rounded-2xl h-12 items-center justify-center active:opacity-70"
        >
          <Text className="text-primary-foreground font-semibold">I&apos;ve written it down</Text>
        </Pressable>
      </KeyStepScreen>
    );
  }

  return (
    // cancelDisabled while busy: onConfirmed() is markRecoveryConfirmed()
    // followed by the upload of this device's key as the account's. Cancelling
    // concurrently would race a local sign-out against a key upload for the
    // very account being signed out of.
    <KeyStepScreen onCancel={onCancel} cancelDisabled={busy}>
      <Text className="text-xl font-semibold text-foreground mb-3">Type it back</Text>
      <Text className="text-sm text-muted-foreground mb-5">
        Just to be sure you have it. Capitals don&apos;t matter.
      </Text>

      <RecoveryCodeInput value={typed} onChange={setTyped} />

      <View className="h-8 justify-center">
        <Text className="text-sm text-muted-foreground">
          {filled === 0 ? '' : matches ? 'That matches.' : `${filled} of ${RECOVERY_WORDS} words`}
        </Text>
      </View>

      <Pressable
        onPress={async () => {
          setBusy(true);
          try {
            await onConfirmed();
          } finally {
            setBusy(false);
          }
        }}
        disabled={!matches || busy}
        className={`rounded-2xl h-12 items-center justify-center ${
          matches && !busy ? 'bg-primary active:opacity-70' : 'bg-muted'
        }`}
      >
        <Text className={`font-semibold ${matches && !busy ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
          {busy ? 'Saving…' : 'Done'}
        </Text>
      </Pressable>
    </KeyStepScreen>
  );
}

/**
 * Twelve slots, three to a row -- the one-box-per-unit idea from an OTP field,
 * at word scale.
 *
 * Why not one long text box, which is what this used to be: a single field
 * gives no feedback until the whole thing is submitted, so a word mistyped
 * fourth is discovered after all twelve are in, with nothing pointing at which
 * one is wrong. Per-slot validation puts the error where the mistake was made.
 *
 * The separator is inserted by moving to the next slot, so nobody types a dash.
 * Space, dash and return all advance, which is what people do without being
 * told. Backspace on an empty slot steps back, or the last word becomes
 * impossible to correct without tapping.
 *
 * Slots are validated when LEFT, not per keystroke -- flagging "ab" as invalid
 * while someone is still typing "abandon" is noise, not help.
 */
export function RecoveryCodeInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const inputs = useRef<(TextInput | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);

  function setWord(index: number, text: string) {
    // A paste of the whole code lands in one slot: spread it across the rest
    // rather than making someone paste twelve times or retype it.
    const parts = text.split(/[^A-Za-z]+/).filter(Boolean);
    if (parts.length > 1) {
      const next = [...value];
      parts.forEach((p, i) => {
        if (index + i < next.length) next[index + i] = p.toLowerCase();
      });
      onChange(next);
      const landed = Math.min(index + parts.length, value.length - 1);
      inputs.current[landed]?.focus();
      return;
    }

    const next = [...value];
    next[index] = text.toLowerCase().replace(/[^a-z]/g, '');
    onChange(next);

    // A separator means "done with this word", so advance on it.
    if (/[\s-]$/.test(text) && index < value.length - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  return (
    <View>
      <View className="flex-row flex-wrap -mx-1">
        {value.map((word, i) => {
          const isFocused = focused === i;
          const bad = !isFocused && word.length > 0 && !isRecoveryWord(word);

          return (
            <View key={i} className="w-1/3 px-1 mb-2">
              <View
                className={`flex-row items-center rounded-xl border px-2 h-11 ${
                  bad
                    ? 'border-destructive'
                    : isFocused
                      ? 'border-foreground'
                      : 'border-border'
                }`}
              >
                <Text className="text-[11px] text-muted-foreground w-4">{i + 1}</Text>
                <TextInput
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  value={word}
                  onChangeText={(t) => setWord(i, t)}
                  onFocus={() => setFocused(i)}
                  onBlur={() => setFocused((f) => (f === i ? null : f))}
                  onSubmitEditing={() => inputs.current[i + 1]?.focus()}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Backspace' && word.length === 0 && i > 0) {
                      inputs.current[i - 1]?.focus();
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  // The list is lowercase ASCII, so the alphabetic keyboard is
                  // the whole alphabet -- no need for anything special, and
                  // asking for a special keyboard would only break autofill.
                  returnKeyType={i === value.length - 1 ? 'done' : 'next'}
                  blurOnSubmit={i === value.length - 1}
                  className="flex-1 text-[15px] text-foreground p-0 ml-1"
                />
              </View>
            </View>
          );
        })}
      </View>

      {/* Suggestions for the slot being typed in. The word list has no two
          words sharing four leading letters, so this collapses to a single
          answer very quickly -- which is exactly why that list was chosen. */}
      <SlotSuggestions
        prefix={focused === null ? '' : value[focused]}
        onPick={(word) => {
          if (focused === null) return;
          const next = [...value];
          next[focused] = word;
          onChange(next);
          inputs.current[focused + 1]?.focus();
        }}
      />
    </View>
  );
}

/**
 * The original single-field input, for the 25-character format.
 *
 * Kept because the codes themselves are: someone who claimed their account
 * before words existed is holding a piece of paper with characters on it, and
 * there is no migration path -- the plaintext code only exists on that paper.
 * AdoptKeyScreen picks this or the word slots from the format recorded on the
 * account, so nobody is ever shown the wrong one.
 *
 * Unreachable from the setup flow: every newly issued code is words.
 */
export function LegacyRecoveryCodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      autoCapitalize="characters"
      autoCorrect={false}
      spellCheck={false}
      placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
      placeholderTextColor="#9CA3AF"
      className="border border-border rounded-2xl h-12 px-4 text-base text-foreground tracking-wider"
    />
  );
}

function SlotSuggestions({
  prefix,
  onPick,
}: {
  prefix: string;
  onPick: (word: string) => void;
}) {
  const words = useMemo(
    () => (prefix.length >= 2 ? suggestRecoveryWords(prefix) : []),
    [prefix]
  );

  // Fixed height whether or not anything is showing, so the button below does
  // not jump every time a suggestion appears.
  return (
    <View className="h-9 flex-row items-center gap-2">
      {words.map((word) => (
        <Pressable
          key={word}
          onPress={() => onPick(word)}
          className="px-3 py-1 rounded-full bg-muted active:opacity-60"
        >
          <Text className="text-xs text-foreground">{word}</Text>
        </Pressable>
      ))}
    </View>
  );
}
