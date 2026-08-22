import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeStateEvent,
} from 'react-native-enriched-html';

import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { toEnrichedHtml } from '@/lib/notes/htmlMigrate';

/**
 * The note editor. Native, no WebView.
 *
 * ONE FILE FOR BOTH PLATFORMS. There used to be three: a TenTap `.native`, a
 * Tiptap `.web`, and a `.tsx` that Metro never resolved because the other two
 * always won -- dead code that still had to be maintained. The replacement
 * library ships its own web implementation, so the platform split has nothing
 * left to do. Web itself is still blocked on the Stage 13 boot failure; this
 * does not fix that and does not pretend to.
 *
 * Replaced @10play/tentap-editor, which was a ProseMirror instance inside a
 * WebView -- slow to start, slow to type in, and a bridge between two
 * JavaScript worlds for every keystroke. This is
 * `react-native-enriched-html`'s `EnrichedTextInput`, which is a real
 * UITextView/EditText underneath.
 *
 * WHAT CARRIED OVER UNCHANGED, and matters more than the editor swap: the echo
 * ledger and the remote-edit hold below. Those solve a sync problem, not an
 * editor problem -- two devices editing one note used to trade the document
 * back and forth forever -- and they are reproduced here exactly, with only the
 * two lines that actually touch the editor changed.
 *
 * STORED FORMAT. Bodies are the editor's own dialect, wrapped in
 * `<html>…</html>`. `toEnrichedHtml` migrates a legacy TenTap body on the way
 * in and is idempotent, so this runs on every open without the document
 * drifting. See lib/notes/htmlMigrate.ts for the two undocumented parser rules
 * it exists to satisfy.
 */

export interface RichEditorProps {
  initialContent?: string;
  onChange?: (html: string) => void;
  autoFocus?: boolean;
  initialScrollOffset?: number;
  onScrollOffsetChange?: (offset: number) => void;
}

/**
 * How long the user must have stopped typing before a remote edit is allowed
 * to replace the document.
 *
 * Long enough to sit clear of the 200ms save debounce and ordinary pauses
 * between words, short enough that putting the phone down for a moment is all
 * it takes for the other device's text to appear.
 */
const REMOTE_APPLY_IDLE_MS = 1500;

/** How many of this editor's own document versions to remember. */
const MAX_ECHO_HISTORY = 50;

/** Debounce before a keystroke becomes a save. */
const CHANGE_DEBOUNCE_MS = 200;

/**
 * Only the keys whose value is a {isActive} record. OnChangeStateEvent also
 * carries at least one plain string member, so `keyof` alone is not safe to
 * index with -- TypeScript is right to object.
 */
type ToggleState = { isActive: boolean; isConflicting: boolean; isBlocking: boolean };
type StyleKey = {
  [K in keyof OnChangeStateEvent]: OnChangeStateEvent[K] extends ToggleState ? K : never;
}[keyof OnChangeStateEvent];

function isActive(state: OnChangeStateEvent | null, key: StyleKey): boolean {
  const entry = state?.[key] as ToggleState | undefined;
  return entry?.isActive === true;
}

/** Toolbar buttons, in render order. `null` is a separator. */
const TOOLBAR: ({ key: StyleKey; icon: any; label: string; run: (r: EnrichedTextInputInstance) => void } | null)[] = [
  { key: 'bold', icon: Bold, label: 'Bold', run: (r) => r.toggleBold() },
  { key: 'italic', icon: Italic, label: 'Italic', run: (r) => r.toggleItalic() },
  // Underline is new. TenTap's toolbar had no underline because Tiptap's
  // starter kit ships none; this editor supports it natively, and the Stage 12
  // reference toolbar shows one.
  { key: 'underline', icon: Underline, label: 'Underline', run: (r) => r.toggleUnderline() },
  { key: 'strikeThrough', icon: Strikethrough, label: 'Strikethrough', run: (r) => r.toggleStrikeThrough() },
  null,
  { key: 'h1', icon: Heading1, label: 'Heading 1', run: (r) => r.toggleH1() },
  { key: 'h2', icon: Heading2, label: 'Heading 2', run: (r) => r.toggleH2() },
  null,
  { key: 'unorderedList', icon: List, label: 'Bullet list', run: (r) => r.toggleUnorderedList() },
  { key: 'orderedList', icon: ListOrdered, label: 'Numbered list', run: (r) => r.toggleOrderedList() },
  null,
  { key: 'blockQuote', icon: Quote, label: 'Block quote', run: (r) => r.toggleBlockQuote() },
  { key: 'inlineCode', icon: Code, label: 'Code', run: (r) => r.toggleInlineCode() },
];

export default function RichEditor({
  initialContent = '',
  onChange,
  autoFocus = false,
}: RichEditorProps) {
  const ref = useRef<EnrichedTextInputInstance>(null);
  const { scheme } = useTheme();

  const migrated = useMemo(() => toEnrichedHtml(initialContent), [initialContent]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Every document version this editor has produced.
   *
   * WHY A LEDGER AND NOT "THE LAST ONE". A save round-trips through SQLite and
   * the watch, so our own text comes back to us. If that echo is mistaken for
   * a remote edit the editor resets its own document, which fires onChange,
   * which saves, which comes back -- and two versions trade places forever
   * until the app locks up. Anything we have said before is our echo, however
   * stale and in whatever order it returns.
   *
   * A Map, not a Set, because Maps keep insertion order and that makes
   * evicting the oldest a one-liner.
   */
  const echoesRef = useRef<Map<string, true>>(new Map([[initialContent, true], [migrated, true]]));

  const rememberEcho = useCallback((html: string) => {
    const ledger = echoesRef.current;
    // Delete-then-set moves an existing entry to the newest position, so a
    // version we keep re-emitting never ages out while it is still live.
    ledger.delete(html);
    ledger.set(html, true);
    if (ledger.size > MAX_ECHO_HISTORY) {
      ledger.delete(ledger.keys().next().value as string);
    }
  }, []);

  const lastTypedAtRef = useRef<number>(0);
  const pendingRemoteRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyRemote = useCallback(
    (rawHtml: string) => {
      pendingRemoteRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      // Applied content counts as ours too: the save it triggers will come back
      // through the watch, and without this that echo reads as another remote
      // edit.
      rememberEcho(rawHtml);
      const next = toEnrichedHtml(rawHtml);
      rememberEcho(next);
      ref.current?.setValue(next);
    },
    [rememberEcho]
  );

  /**
   * Apply a held remote edit once typing has actually stopped.
   *
   * Re-checks rather than trusting the delay it was scheduled with: the user
   * may have carried on typing since, and a timer that fired regardless would
   * reset the document mid-sentence -- the exact thing the hold prevents.
   */
  const applyPendingRemote = useCallback(() => {
    const pending = pendingRemoteRef.current;
    if (pending === null) return;

    const sinceTyping = Date.now() - lastTypedAtRef.current;
    if (sinceTyping >= REMOTE_APPLY_IDLE_MS) {
      applyRemote(pending);
      return;
    }
    pendingTimerRef.current = setTimeout(applyPendingRemote, REMOTE_APPLY_IDLE_MS - sinceTyping);
  }, [applyRemote]);

  /**
   * React to a changed `initialContent` -- which, despite the name, is the live
   * body of the open note. A remote edit does not change the note id, so
   * nothing remounts and this is the only thing that pushes new text in.
   */
  useEffect(() => {
    // Compared RAW, against every version this editor has produced, because
    // what it emitted is what got stored and what got stored is what comes
    // back.
    if (echoesRef.current.has(initialContent)) return;

    const sinceTyping = Date.now() - lastTypedAtRef.current;
    if (sinceTyping > REMOTE_APPLY_IDLE_MS) {
      applyRemote(initialContent);
      return;
    }

    // Held with its OWN timer, not the onChange debounce: onChange only fires
    // on a keystroke, so an edit arriving just as the user stopped typing would
    // sit here until they typed again -- and that pause is exactly when the
    // other device's text should appear.
    pendingRemoteRef.current = initialContent;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(applyPendingRemote, REMOTE_APPLY_IDLE_MS - sinceTyping);
  }, [initialContent, applyRemote, applyPendingRemote]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  const handleChangeHtml = useCallback(
    (event: { nativeEvent: { value: string } }) => {
      const html = event.nativeEvent.value;
      lastTypedAtRef.current = Date.now();
      rememberEcho(html);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChangeRef.current?.(html);
      }, CHANGE_DEBOUNCE_MS);
    },
    [rememberEcho]
  );

  const [styleState, setStyleState] = useState<OnChangeStateEvent | null>(null);
  const handleChangeState = useCallback(
    (event: { nativeEvent: OnChangeStateEvent }) => setStyleState(event.nativeEvent),
    []
  );

  const isDark = scheme === 'dark';
  const text = isDark ? '#fafafa' : '#111111';
  const muted = isDark ? '#8b8b8b' : '#6b6b6b';
  const surface = isDark ? '#1c1c1c' : '#f4f4f4';

  return (
    <Box className="flex-1 bg-background flex flex-col">
      {/* Toolbar ABOVE the canvas. Nothing here avoids the keyboard, so a
          toolbar underneath the text was covered the moment you started typing
          -- unreachable exactly when it was wanted. */}
      <Box className="border-b border-border bg-background px-3 py-1.5">
        <HStack className="items-center space-x-1 flex-wrap">
          {TOOLBAR.map((item, i) =>
            item === null ? (
              <Box key={`sep-${i}`} className="w-px h-4 bg-border mx-1" />
            ) : (
              <Pressable
                key={item.key}
                onPress={() => {
                  const instance = ref.current;
                  if (instance) item.run(instance);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                className={`p-2 rounded-lg ${
                  isActive(styleState, item.key)
                    ? 'bg-lime-100 dark:bg-lime-900/40'
                    : 'bg-transparent'
                }`}
              >
                <Icon
                  as={item.icon}
                  className={`w-4 h-4 ${
                    isActive(styleState, item.key)
                      ? 'text-lime-700 dark:text-lime-400'
                      : 'text-muted-foreground'
                  }`}
                />
              </Pressable>
            )
          )}
        </HStack>
      </Box>

      <View style={{ flex: 1 }}>
        <EnrichedTextInput
          ref={ref}
          defaultValue={migrated}
          autoFocus={autoFocus}
          onChangeHtml={handleChangeHtml}
          onChangeState={handleChangeState}
          // color MUST be set explicitly. The input is a real UITextView and
          // defaults to black, so in dark mode the note rendered as black text
          // on a black background -- invisible, and it looked like the editor
          // had failed to load rather than like a styling bug.
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingTop: 12,
            color: text,
            fontSize: 17,
            lineHeight: 24,
          }}
          androidExperimentalSynchronousEvents
          cursorColor="#84cc16"
          selectionColor="#84cc1655"
          placeholderTextColor={muted}
          placeholder=""
          htmlStyle={{
            h1: { fontSize: 28, bold: true },
            h2: { fontSize: 22, bold: true },
            h3: { fontSize: 19, bold: true },
            blockquote: { borderColor: muted, borderWidth: 3, gapWidth: 12, color: muted },
            code: { color: text, backgroundColor: surface },
            codeblock: { color: text, backgroundColor: surface, borderRadius: 8 },
            a: { color: '#84cc16', textDecorationLine: 'underline' },
            ul: { bulletColor: muted, marginLeft: 12, gapWidth: 8 },
            ol: { markerColor: muted, marginLeft: 12, gapWidth: 8 },
          }}
        />
      </View>
    </Box>
  );
}
