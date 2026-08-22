import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ScrollView, Text as RNText, TextInput, View } from 'react-native';

import { isPlainTextSafe, toPlainText, toPlainTextHtml } from '@/lib/notes/plainTextBody';
import type { RichEditorHandle, RichEditorProps } from './RichEditor';

/**
 * THE WEB EDITOR: plain text, and honest about it.
 *
 * ── WHY IT IS NOT THE REAL EDITOR ─────────────────────────────────────────
 *
 * The native editor is `react-native-enriched-html`, which is genuinely native
 * on iOS and Android. Its WEB implementation is a `@tiptap` stack, and that
 * chain is both marked experimental and, in this tree, unresolvable -- a broken
 * npm hoist puts `@tiptap/extensions` inside the library's own node_modules
 * while `@tiptap/extension-history` is hoisted to the top level, so the web
 * bundle died with a TransformError before any app code ran. Stage 12b kept the
 * whole chain out of the bundle with this file. Stage 13 owns what the web
 * editor finally becomes.
 *
 * ── WHY IT IS NO LONGER READ-ONLY ─────────────────────────────────────────
 *
 * It was, and that was the wrong answer to the wrong question. Adam,
 * 2026-08-22: the user has to be "able to work offline, create and export
 * notes". A note you can open and cannot type into is not a way through; it is
 * the same dead end as the boot failure screen, one screen further in.
 *
 * Plain text is a real editor. Everything else in the app works on web now --
 * the list, folders, trash, search, the note lifecycle -- and this is the one
 * piece that is reduced.
 *
 * ── THE GUARD, WHICH IS THE PART WORTH READING ────────────────────────────
 *
 * A formatted note projected into plain text and saved back comes out flat.
 * That damage needs no keystroke: the editor autosaves, so merely OPENING a
 * bold-and-bullets note on web would have been enough to destroy its
 * formatting. So a note is editable here only when there is nothing to lose --
 * see `isPlainTextSafe`. Everything else renders read-only, legibly, with the
 * reason stated rather than a control that silently does nothing.
 *
 * That guard is why the badge below has two texts and not one.
 */
/** Plain text has no formatting. See the native file for what this is for. */
export const EDITOR_SUPPORTS_FORMATTING = false;

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { initialContent = '', onChange, autoFocus, contentInsetTop = 0 },
  handle
) {
  // The web editor IS a real RN TextInput (a <textarea>), so unlike the native
  // one it would also answer to Keyboard.dismiss(). It still implements the
  // handle, because the caller must not have to know which editor it got.
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(
    handle,
    () => ({
      blur: () => inputRef.current?.blur(),
      // Plain text has no formatting to apply. A no-op rather than an omission,
      // so a caller never has to ask which editor it got -- the desktop bar's
      // Checklist button is simply inert here, matching the badge that already
      // says this editor is plain text.
      run: () => {},
    }),
    []
  );
  const editable = useMemo(() => isPlainTextSafe(initialContent), [initialContent]);

  /**
   * Local text, re-seeded only when the note ITSELF changes.
   *
   * The parent hands `initialContent` straight back after every save, so
   * following it blindly would reset the caret to the end of the document
   * mid-sentence. The second half of the condition is what distinguishes the
   * two cases: if the incoming body is what this component's own text would
   * produce, it is our own save echoing back and must be ignored. If it is
   * anything else, a different note has been opened and the editor has to
   * follow it.
   *
   * This is the small web cousin of the native editor's echo ledger, and it
   * exists for the same reason -- there, with sync running, the ledger has to
   * tell a remote edit from an echo; here there is no sync yet, so "is it my
   * own last output" is enough.
   */
  const [seed, setSeed] = useState(initialContent);
  const [text, setText] = useState(() => toPlainText(initialContent));

  if (initialContent !== seed && toPlainTextHtml(text) !== initialContent) {
    setSeed(initialContent);
    setText(toPlainText(initialContent));
  }

  const handleChange = (next: string) => {
    setText(next);
    onChange?.(toPlainTextHtml(next));
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingTop: contentInsetTop + 16 }}
    >
      <View className="mb-3 self-start rounded-full bg-foreground/10 px-3 py-1">
        <RNText className="text-xs text-muted-foreground">
          {editable
            ? 'Plain text on web · this session only'
            : 'Read-only here — this note has formatting web can’t edit yet'}
        </RNText>
      </View>

      {editable ? (
        <TextInput
          ref={inputRef}
          multiline
          autoFocus={autoFocus}
          value={text}
          onChangeText={handleChange}
          placeholder="Start typing"
          // react-native-web renders a <textarea>; without this it keeps its
          // own default focus ring on top of the app's own surfaces.
          style={{ outlineStyle: 'none' } as any}
          className="text-base text-foreground min-h-[60vh]"
          textAlignVertical="top"
        />
      ) : (
        /**
         * Tags stripped rather than rendered. `dangerouslySetInnerHTML` would
         * put unsanitised stored HTML into the DOM, and a note body is the one
         * string in this app most likely to carry markup from a paste or an
         * import. Read-only plain text costs this view its formatting; the
         * alternative costs an XSS.
         */
        <RNText className="text-base text-foreground" selectable>
          {toPlainText(initialContent)}
        </RNText>
      )}
    </ScrollView>
  );
});

export default RichEditor;
