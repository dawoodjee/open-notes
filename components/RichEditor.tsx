import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View } from 'react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeStateEvent,
} from 'react-native-enriched-html';

import { Box } from '@/components/ui/box';

import { useTheme } from '@/contexts/ThemeContext';
import { toEnrichedHtml } from '@/lib/notes/htmlMigrate';
import { FormatBar } from './FormatBar';
import { TextStylePanel } from './TextStylePanel';
import { BLOCK_STYLES, paragraphStyleToggles } from '@/lib/notes/paragraphStyle';
import { useKeyboardShown } from '@/hooks/useKeyboardShown';
import type { ToolKey } from '@/lib/notes/toolbarContext';

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
  /**
   * Space to leave clear at the top of the document.
   *
   * The phone's nav bar FLOATS over the note, so the first line has to start
   * below it or the title is hidden behind the controls before you have typed
   * a character. Content then scrolls UNDER the bar, which is the behaviour the
   * reference shows -- same rule as the desktop bar's own inset.
   */
  contentInsetTop?: number;
  onScrollOffsetChange?: (offset: number) => void;
  /**
   * Desktop only: whether the top bar's `Aa` popover is open.
   *
   * The BAR owns this boolean because the bar owns the button; the editor owns
   * everything the panel actually renders. See TextStylePanel for why the split
   * falls there.
   */
  textStyleOpen?: boolean;
  onCloseTextStyle?: () => void;
  /** Distance from the top of this pane to the underside of a floating bar,
   *  so the panel hangs from it rather than from the window edge. */
  textStyleTop?: number;
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

/**
 * ToolKey -> what the editor actually does for it.
 *
 * Only the supported keys appear. `lib/notes/toolbarContext.ts` owns which
 * keys EXIST and in what order; this owns what pressing one does, and a key
 * missing from here is a key the editor cannot perform -- which is the same
 * list `isSupported` reports, kept honest by the test that pins it.
 */
const RUN: Partial<Record<ToolKey, (r: EnrichedTextInputInstance) => void>> = {
  bold: (r) => r.toggleBold(),
  italic: (r) => r.toggleItalic(),
  underline: (r) => r.toggleUnderline(),
  strikethrough: (r) => r.toggleStrikeThrough(),
  heading: (r) => r.toggleH1(),
  heading2: (r) => r.toggleH2(),
  heading3: (r) => r.toggleH3(),
  // Body is the ABSENCE of a block style, so there is nothing to "turn on".
  // Running it turns OFF whichever block style is currently active -- the
  // library's toggles are their own inverse, so re-toggling the active one is
  // the whole implementation. Which one that is comes from the caller's state,
  // so this needs the caret's state and is handled in `runTool`, not here.
  bulletList: (r) => r.toggleUnorderedList(),
  numberedList: (r) => r.toggleOrderedList(),
  // `checked` is required, and false is the only sensible default: a fresh
  // checklist whose items arrive pre-ticked is a to-do list already done.
  checklist: (r) => r.toggleCheckboxList(false),
  blockquote: (r) => r.toggleBlockQuote(),
  code: (r) => r.toggleInlineCode(),
  codeBlock: (r) => r.toggleCodeBlock(),
};

/** ToolKey -> the editor's own state key, for the selected/blocked flags. */
const STATE_KEY: Partial<Record<ToolKey, StyleKey>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strikeThrough',
  heading: 'h1',
  heading2: 'h2',
  heading3: 'h3',
  bulletList: 'unorderedList',
  numberedList: 'orderedList',
  checklist: 'checkboxList',
  blockquote: 'blockQuote',
  code: 'inlineCode',
  codeBlock: 'codeBlock',
  link: 'link',
  image: 'image',
};

/**
 * What a parent can ask the editor to do.
 *
 * Exactly one thing so far, and it exists because `Keyboard.dismiss()` does not
 * work here. That RN helper blurs the focused *RN* TextInput; this editor is a
 * real UITextView behind a Fabric component and never sees it, so the phone's
 * Done button was inert on iOS from the moment it shipped -- it rendered, it
 * pressed, and the keyboard stayed up. The library exposes `blur()` on its own
 * instance for precisely this, so the parent needs a way to reach it.
 */
/**
 * Whether the editor this platform got can apply formatting at all.
 *
 * A module constant rather than a prop or a handle method, because it is a
 * build-time fact: Metro resolves `RichEditor.web.tsx` on web, where the editor
 * is plain text and this is `false`. Chrome around the editor reads it to
 * decide whether its formatting controls are live or dimmed -- the same
 * standing rule that dims Table and Attach, applied to a whole editor.
 */
export const EDITOR_SUPPORTS_FORMATTING = true;

export interface RichEditorHandle {
  /** Removes focus and dismisses the software keyboard. */
  blur: () => void;
  /** Apply a formatting action. Used by the desktop bar, whose Checklist
   *  button sits outside this component. */
  run: (key: ToolKey) => void;
}

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  {
    initialContent = '',
    onChange,
    autoFocus = false,
    contentInsetTop = 0,
    textStyleOpen = false,
    onCloseTextStyle,
    textStyleTop = 0,
  },
  handle
) {
  const ref = useRef<EnrichedTextInputInstance>(null);

  useImperativeHandle(
    handle,
    () => ({
      blur: () => ref.current?.blur(),
      run: (key: ToolKey) => runToolRef.current(key),
    }),
    []
  );

  /**
   * `run` is reached through a ref rather than closed over directly.
   *
   * `runTool` depends on `styleState` (Body needs it), so it is a NEW function
   * on every keystroke. Listing it in the handle's deps would rebuild the
   * handle just as often, and a parent holding `editorRef.current` would be
   * holding a stale object between renders. The ref is stable; what it points
   * at is current.
   */
  const runToolRef = useRef<(key: ToolKey) => void>(() => {});
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
  const [barExpanded, setBarExpanded] = useState(false);
  const handleChangeState = useCallback(
    (event: { nativeEvent: OnChangeStateEvent }) => setStyleState(event.nativeEvent),
    []
  );

  /**
   * What the bar needs, derived from the editor's own report.
   *
   * `onBlankBodyLine` is the one signal `onChangeState` does NOT provide -- it
   * says which FORMATS are active, never whether the line has any text. So it
   * is approximated as "no block format is active", which is true for an empty
   * paragraph and also true for a paragraph with text in it. That is a
   * deliberate over-reach rather than a bug: the consequence is that Heading
   * and Bulleted list come forward on ordinary body text too, which is exactly
   * where someone is most likely to want them. The alternative -- reading the
   * caret's line contents on every keystroke -- costs a round trip per
   * character to sharpen a rule that is already useful.
   */
  const onListItem =
    isActive(styleState, 'unorderedList') ||
    isActive(styleState, 'orderedList') ||
    isActive(styleState, 'checkboxList');

  const onBlankBodyLine =
    !onListItem &&
    !isActive(styleState, 'h1') &&
    !isActive(styleState, 'h2') &&
    !isActive(styleState, 'h3') &&
    !isActive(styleState, 'blockQuote') &&
    !isActive(styleState, 'codeBlock');

  const activeTools = useMemo(() => {
    const out: Partial<Record<ToolKey, boolean>> = {};
    for (const [tool, key] of Object.entries(STATE_KEY) as [ToolKey, StyleKey][]) {
      out[tool] = isActive(styleState, key);
    }
    return out;
  }, [styleState]);

  const blockedTools = useMemo(() => {
    const out: Partial<Record<ToolKey, boolean>> = {};
    for (const [tool, key] of Object.entries(STATE_KEY) as [ToolKey, StyleKey][]) {
      const entry = styleState?.[key] as ToggleState | undefined;
      out[tool] = entry?.isBlocking === true;
    }
    return out;
  }, [styleState]);

  /**
   * Whether any text is actually SELECTED, as opposed to the caret merely
   * sitting somewhere.
   *
   * This is the second half of when the formatting bar is allowed on screen.
   * The keyboard covers the ordinary case -- you are typing, so you may want to
   * format -- but not the one where the keyboard is down and a range is
   * highlighted, which is exactly when someone reaches for bold. That happens
   * with an external keyboard, and on iPad after a long-press selection
   * dismisses the software keyboard.
   */
  const [hasSelection, setHasSelection] = useState(false);
  const handleChangeSelection = useCallback(
    (event: { nativeEvent: { start: number; end: number } }) => {
      const { start, end } = event.nativeEvent;
      setHasSelection(end > start);
    },
    []
  );

  const keyboardShown = useKeyboardShown();

  const runTool = useCallback(
    (key: ToolKey) => {
      const instance = ref.current;
      if (!instance) return;

      /**
       * BODY IS NOT A FORMAT, it is the absence of one, and the editor has no
       * "make this a paragraph" call. So it is implemented as: turn off
       * whatever block style is on. The library's toggles are their own
       * inverse, so re-running the active one clears it.
       *
       * This is why Body lives in `runTool` and not in the RUN map -- it is the
       * one action that needs to know the caret's current state, which a static
       * map of `(instance) => void` cannot see.
       */
      if (BLOCK_STYLES.includes(key) || key === 'body') {
        // Which toggles to fire is decided by lib/notes/paragraphStyle.ts, and
        // tested there. It matters that this is not written inline: "make this
        // Body" is "toggle off whatever is on", and the naive version -- toggle
        // every block style -- would turn six of them ON, because the editor's
        // block toggles are their own inverse.
        for (const style of paragraphStyleToggles(activeTools, key)) {
          RUN[style]?.(instance);
        }
        return;
      }

      const run = RUN[key];
      // Unsupported keys reach here only if a disabled button were ever
      // pressable. Ignored rather than thrown: a formatting bar is not the
      // place to crash an editor holding unsaved text.
      if (run) run(instance);
    },
    [activeTools]
  );

  runToolRef.current = runTool;

  const isDark = scheme === 'dark';
  const text = isDark ? '#fafafa' : '#111111';
  const muted = isDark ? '#8b8b8b' : '#6b6b6b';
  const surface = isDark ? '#1c1c1c' : '#f4f4f4';

  return (
    <Box className="flex-1 bg-background flex flex-col">
      <View style={{ flex: 1 }}>
        <EnrichedTextInput
          ref={ref}
          defaultValue={migrated}
          autoFocus={autoFocus}
          onChangeHtml={handleChangeHtml}
          onChangeState={handleChangeState}
          onChangeSelection={handleChangeSelection}
          // color MUST be set explicitly. The input is a real UITextView and
          // defaults to black, so in dark mode the note rendered as black text
          // on a black background -- invisible, and it looked like the editor
          // had failed to load rather than like a styling bug.
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingTop: 12 + contentInsetTop,
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

      {/* ON SCREEN ONLY WHEN THERE IS SOMETHING TO FORMAT, and it rides the
          keyboard the whole way (Adam, 2026-08-22).

          It used to stay put when the keyboard went down, sitting on the home
          indicator. The reasoning was that it is the only formatting affordance
          on a phone -- but the consequence was a bar permanently occupying the
          bottom of the screen while you were only READING a note, which is most
          of what anybody does with one. Dismissing the keyboard is how you say
          "I am done editing"; the bar has to hear that.

          `styleState !== null` is still required: before the editor has reported
          any state the bar would render every control in its resting, unselected
          look, which is a lie about a document it has not read yet. */}
      <TextStylePanel
        open={textStyleOpen}
        onClose={() => onCloseTextStyle?.()}
        active={activeTools}
        blocked={blockedTools}
        onRun={runTool}
        top={textStyleTop}
      />

      <FormatBar
        active={activeTools}
        blocked={blockedTools}
        onListItem={onListItem}
        onBlankBodyLine={onBlankBodyLine}
        onRun={runTool}
        expanded={barExpanded}
        onToggleExpanded={() => setBarExpanded((v) => !v)}
        visible={styleState !== null && (keyboardShown || hasSelection)}
      />
    </Box>
  );
});

export default RichEditor;
