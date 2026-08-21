import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import type { WebViewMessageEvent } from 'react-native-webview';
import {
  useEditorBridge,
  RichText,
  TenTapStartKit,
  CoreBridge,
  ImageBridge,
  useBridgeState,
} from '@10play/tentap-editor';

// Gluestack UI Primitives
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';

// Lucide Icons
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Code,
  Quote,
  IndentIncrease,
  IndentDecrease,
} from 'lucide-react-native';
import { useTheme, type BulletStyle } from '@/contexts/ThemeContext';

export interface RichEditorProps {
  initialContent?: string;
  onChange?: (html: string) => void;
  autoFocus?: boolean;
  initialScrollOffset?: number;
  onScrollOffsetChange?: (offset: number) => void;
}

// Namespaced so it can't collide with TenTap's own bridge message types
const SCROLL_MESSAGE_TYPE = 'notes-editor-scroll';

/**
 * How long the user must have stopped typing before a remote edit is allowed
 * to replace the document.
 *
 * Long enough to sit clear of the 200ms save debounce and ordinary pauses
 * between words, short enough that putting the phone down for a moment is all
 * it takes for the other device's text to appear.
 */
const REMOTE_APPLY_IDLE_MS = 1500;

/**
 * How many of this editor's own document versions to remember.
 *
 * Only needs to outlast the writes that can be in flight at once: editor
 * debounce (200ms) + SQLite debounce (300ms) + watch delivery. Fifty is far
 * more than that even while typing hard, and the ledger is per-open-note, so
 * the ceiling is fifty strings for as long as one note is on screen.
 */
const MAX_ECHO_HISTORY = 50;

// Walks up from the ProseMirror node to whichever ancestor actually scrolls,
// rather than assuming it's the document (it isn't — TenTap scrolls a container).
const FIND_SCROLLER_JS = `
  window.__notesFindScroller = function() {
    var candidates = [];
    var node = document.querySelector('.ProseMirror');
    while (node && node !== document.documentElement) {
      candidates.push(node);
      node = node.parentElement;
    }
    candidates.push(document.scrollingElement, document.documentElement, document.body);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el && el.scrollHeight > el.clientHeight + 4) return el;
    }
    return document.scrollingElement || document.documentElement;
  };
`;

// Ensure initial HTML starts with an <h1> without extra blank elements
function formatInitialContent(content: string): string {
  if (!content || content.trim() === '' || content === '<p></p>') {
    return '<h1></h1>';
  }
  const trimmed = content.trim();
  if (/^<h[1-6]/i.test(trimmed)) {
    return trimmed;
  }
  if (/^<p>/i.test(trimmed)) {
    return trimmed.replace(/^<p>(.*?)<\/p>/i, '<h1>$1</h1>');
  }
  return `<h1>${trimmed}</h1>`;
}

// Helper to strip any auto-inserted <br> tags from output HTML
function sanitizeHtmlOutput(html: string): string {
  return html
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '<p></p>')
    .replace(/<br\s*\/?>\s*<\/p>/gi, '</p>')
    .replace(/<br\s*\/?>$/gi, '');
}

/**
 * The editor's palette, per scheme.
 *
 * The WebView is its own document. No Tailwind class, no NativeWind variant
 * and no Appearance.setColorScheme call reaches inside it, so the theme has to
 * be handed across the bridge explicitly -- which is what makes this the one
 * part of dark mode that needs its own mechanism.
 */
const EDITOR_COLORS = {
  light: {
    bg: '#fbfbfd',
    fg: '#1c1c1e',
    body: '#374151',
    heading: '#111827',
    subheading: '#1f2937',
    muted: '#636366',
    codeBg: '#f2f2f7',
    selectionBg: '#ECFCCB',
    selectionFg: '#365314',
    caret: '#1c1c1e',
  },
  dark: {
    bg: '#0a0a0c',
    fg: '#fafafa',
    body: '#d4d4d4',
    heading: '#fafafa',
    subheading: '#e5e5e5',
    muted: '#a1a1a1',
    codeBg: '#262626',
    selectionBg: '#3f6212',
    selectionFg: '#ecfccb',
    caret: '#fafafa',
  },
} as const;

/** The variable assignments for one scheme, as a CSS declaration block. */
function editorColorVars(scheme: 'light' | 'dark'): string {
  const c = EDITOR_COLORS[scheme];
  return Object.entries(c)
    .map(([name, value]) => `--editor-${name}: ${value};`)
    .join('\n    ');
}

/**
 * What a bullet is drawn as, per style.
 *
 * These are CSS `content` values, which is why the quotes are part of the
 * string: without them `-` would be read as a keyword and the marker would
 * simply not render. They ride in the same variable channel as the colours, so
 * switching styles is a one-property write rather than a new stylesheet.
 *
 * The bullet is the literal character, NOT the CSS escape `\2022`. This string
 * gets interpolated into a JS template literal on its way into the WebView
 * (see the warning in editorThemeCSS), and a backslash-digit sequence is an
 * illegal escape inside one -- the whole stylesheet fails to parse and the
 * editor silently falls back to unstyled serif.
 */
const BULLET_MARKERS: Record<BulletStyle, string> = {
  dash: '"-"',
  dot: '"•"',
};

// Authentic Apple Notes typography forced across all WebView nodes.
//
// Written entirely against custom properties so the theme can be changed
// later by resetting the variables (see applyEditorTheme) rather than
// rebuilding the stylesheet -- which would mean recreating the bridge, and
// with it losing the caret and re-running the scroll restore every time.
//
// TAKES THE SCHEME AND MARKER rather than baking in light-with-dots and
// correcting after load. Injection only lands once the page is up, so a
// stylesheet that always started light meant opening a note in dark mode
// flashed white for as long as the WebView took to load. Baking the right
// values in means there is no wrong frame to correct.
//
// NOTHING IN THIS STRING MAY CONTAIN A BACKTICK OR A BACKSLASH. TenTap ships
// the stylesheet by interpolating it into a JS template literal of its own
// (getStyleSheetCSS in RichText/utils), so a backtick ends that literal early
// and a backslash-digit sequence is an illegal escape inside one. Either way
// the injected script fails to parse, no stylesheet is installed at all, and
// the editor renders as unstyled serif -- with no error anywhere saying why.
// Write CSS escapes as literal characters instead.
const editorThemeCSS = (scheme: 'light' | 'dark', bulletStyle: BulletStyle) => `
  :root {
    ${editorColorVars(scheme)}
    --editor-bullet-marker: ${BULLET_MARKERS[bulletStyle]};
  }
  * {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body, html {
    margin: 0;
    padding: 0;
    color: var(--editor-fg);
    background-color: var(--editor-bg);
    font-size: 16px;
    line-height: 1.5;
  }
  .ProseMirror {
    outline: none;
    min-height: 100vh;
    padding: 24px;
    caret-color: var(--editor-caret);
  }
  .ProseMirror p {
    margin-top: 0;
    margin-bottom: 0.75rem;
    color: var(--editor-body);
  }
  h1 {
    font-size: 1.875rem;
    font-weight: 700;
    color: var(--editor-heading);
    margin-top: 0;
    margin-bottom: 0.25rem;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--editor-subheading);
    margin-top: 0.75rem;
    margin-bottom: 0.25rem;
  }
  blockquote {
    border-left: 3px solid #84CC16;
    padding-left: 1rem;
    margin: 0 0 0.75rem 0;
    color: var(--editor-muted);
    font-style: italic;
  }
  code {
    background-color: var(--editor-codeBg);
    color: var(--editor-fg);
    padding: 0.2rem 0.4rem;
    border-radius: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
    font-size: 0.9em;
  }
  /* LISTS.
     Tiptap wraps every item's text in a paragraph -- <li><p>text</p></li> --
     so the .ProseMirror p rule above was silently putting 0.75rem under every
     single bullet. A gap sized for the space between paragraphs, applied
     between items, is what made one list read as several. The list's own
     margin-top was never reset either, so the browser's default 1em sat on top
     of that. */
  .ProseMirror ul, .ProseMirror ol {
    padding-left: 1.25rem;
    margin-top: 0;
    margin-bottom: 0.75rem;
  }
  .ProseMirror li > p {
    margin-bottom: 0;
  }
  .ProseMirror li {
    margin-bottom: 0.125rem;
  }
  /* A nested list is a continuation of its item, not the end of one, so it
     gets none of the gap that closes a list off. */
  .ProseMirror li > ul, .ProseMirror li > ol {
    margin-top: 0.125rem;
    margin-bottom: 0;
  }

  /* BULLET MARKERS, drawn by hand rather than by list-style.
     There is only one bulletList node -- a typed dash, a typed asterisk and
     the toolbar button all produce it -- so the marker is a global preference,
     and a pseudo element is the way to control it everywhere. list-style-type
     accepts a string these days, but only from Safari 17, and ::before works
     on every WebView this app can run in. Ordered lists keep their numbers.

     Task lists are excluded: their marker is a checkbox, and TenTap already
     styles them. Without the :not() every checkbox would grow a dash. */
  .ProseMirror ul:not([data-type="taskList"]) {
    list-style: none;
  }
  .ProseMirror ul:not([data-type="taskList"]) > li {
    position: relative;
  }
  .ProseMirror ul:not([data-type="taskList"]) > li::before {
    content: var(--editor-bullet-marker);
    position: absolute;
    left: -1.05rem;
    color: var(--editor-body);
  }
  ::selection {
    background-color: var(--editor-selectionBg);
    color: var(--editor-selectionFg);
  }
`;

/**
 * JS that repaints the document for a scheme and bullet style, for injection
 * over the bridge.
 *
 * Every appearance choice is a variable precisely so this can exist: setting
 * properties on :root restyles the live document, where rebuilding the
 * stylesheet would mean rebuilding the bridge -- losing the caret, the
 * selection and the scroll position every time the theme or the marker moved.
 */
function applyEditorThemeJS(scheme: 'light' | 'dark', bulletStyle: BulletStyle): string {
  const c = EDITOR_COLORS[scheme];
  const assignments = Object.entries(c)
    .map(([name, value]) => `r.style.setProperty('--editor-${name}', '${value}');`)
    .join('\n      ');
  // JSON.stringify, because the marker carries its own quotes -- see
  // BULLET_MARKERS -- and pasting it in raw would close the JS string early.
  const marker = JSON.stringify(BULLET_MARKERS[bulletStyle]);
  return `
    (function() {
      var r = document.documentElement;
      ${assignments}
      r.style.setProperty('--editor-bullet-marker', ${marker});
    })();
    true;
  `;
}

export default function RichEditor({
  initialContent = '',
  onChange,
  autoFocus = false,
  initialScrollOffset = 0,
  onScrollOffsetChange,
}: RichEditorProps) {
  const formattedContent = useMemo(
    () => formatInitialContent(initialContent),
    [initialContent]
  );

  const onChangeRef = useRef(onChange);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Live remote updates -------------------------------------------------
  /**
   * Every document version this editor has produced or applied.
   *
   * This used to be a single `lastEmittedRef`, and that was a real bug: with
   * only the most recent value to compare against, an OLD echo of our own
   * typing is indistinguishable from a genuine edit by another device.
   *
   * Saving is not instant -- editor debounce, then SQLite debounce, then the
   * watch query delivers the new body back. Type quickly and several of those
   * overlap, and they do not necessarily come back in the order they were
   * sent. So the watch hands us version A while we have already emitted the
   * newer version B. A !== B, the old check called that "remote", and
   * setContent rewound the document. That re-fires onChange, which saves,
   * which comes back... and A and B trade places forever, replacing the whole
   * document each time, until the app locks up.
   *
   * A ledger fixes the classification at its root: anything we have said
   * before is our own echo, however stale and whatever order it arrives in.
   * Only content we have genuinely never produced is a remote edit.
   *
   * A Map (not a Set) because Maps keep insertion order, which makes evicting
   * the oldest entry a one-liner and keeps this bounded.
   */
  const echoesRef = useRef<Map<string, true>>(new Map([[initialContent, true]]));

  /** Record a version as ours, refreshing its recency and capping the ledger. */
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
  // When the user last typed. Remote content is never applied on top of active
  // typing -- setContent resets the document and takes the caret with it.
  const lastTypedAtRef = useRef<number>(0);
  // Remote content that arrived mid-sentence and is waiting for a pause.
  const pendingRemoteRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const { scheme, bulletStyle } = useTheme();

  // Read once, deliberately. useEditorBridge builds the bridge on first render
  // and ignores later changes to these arguments, so these are the scheme and
  // marker the document STARTS in; applyEditorTheme below handles every change
  // after. NoteEditorPane keys this component on the note id, so opening any
  // note rebuilds the bridge with whatever is current at that moment.
  //
  // Baking both in is what keeps the first painted frame correct: the
  // stylesheet only lands once the page is up, so a document that always
  // started light-with-dots would visibly correct itself on every open.
  const initialSchemeRef = useRef(scheme);
  const initialBulletStyleRef = useRef(bulletStyle);

  const editor = useEditorBridge({
    initialContent: formattedContent,
    autofocus: autoFocus,
    bridgeExtensions: [
      ...TenTapStartKit,
      CoreBridge.configureCSS(
        editorThemeCSS(initialSchemeRef.current, initialBulletStyleRef.current)
      ),
      ImageBridge,
    ],
    avoidIosKeyboard: true,
    onChange: () => {
      lastTypedAtRef.current = Date.now();

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        if (onChangeRef.current && editor) {
          const html = await editor.getHTML();
          const cleanHtml = sanitizeHtmlOutput(html);
          // Recorded BEFORE the save is handed over, so the echo can never
          // arrive back before the ledger knows about it.
          rememberEcho(cleanHtml);
          onChangeRef.current(cleanHtml);
        }
        // Typing has stopped for at least one debounce window, so this is the
        // moment a held-back remote edit can land without stealing the caret.
        applyPendingRemote();
      }, 200);
    },
  });

  /**
   * Push content from another device into the live document.
   *
   * setContent replaces the whole document, so the caret goes back to the
   * start -- acceptable when the user isn't typing, jarring when they are.
   * Hence the idle test rather than applying unconditionally.
   */
  const applyRemote = useCallback(
    (rawHtml: string) => {
      pendingRemoteRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      // Applied content counts as ours too: the save it triggers will come
      // back through the watch, and without this that echo would read as yet
      // another remote edit.
      rememberEcho(rawHtml);
      editor.setContent(formatInitialContent(rawHtml));
    },
    [editor, rememberEcho]
  );

  /**
   * Apply a held remote edit once typing has actually stopped.
   *
   * Re-checks rather than trusting the delay it was scheduled with: the user
   * may have carried on typing since, and a timer that fires regardless would
   * reset the document mid-sentence -- the exact thing the hold exists to
   * prevent. Reschedules itself instead, so it lands on the first real pause.
   */
  const applyPendingRemote = useCallback(() => {
    const pending = pendingRemoteRef.current;
    if (pending === null) return;

    const sinceTyping = Date.now() - lastTypedAtRef.current;
    if (sinceTyping >= REMOTE_APPLY_IDLE_MS) {
      applyRemote(pending);
      return;
    }
    pendingTimerRef.current = setTimeout(
      applyPendingRemote,
      REMOTE_APPLY_IDLE_MS - sinceTyping
    );
  }, [applyRemote]);

  /**
   * React to a changed `initialContent` -- which, despite the name, is the
   * live body of the open note.
   *
   * It used to be read exactly once, at bridge construction. Since
   * NoteEditorPane keys this component on the note's id, and a remote edit
   * doesn't change the id, nothing remounted and nothing pushed the new text
   * in: a note open on two devices never updated on the second until it was
   * closed and reopened. Worse, the next keystroke saved the stale buffer back
   * over the merged content.
   */
  useEffect(() => {
    // Compared RAW, against every version this editor has produced -- because
    // what it emitted is what got stored, and what got stored is what comes
    // back. Comparing the *formatted* version instead would produce phantom
    // remote edits: an emitted `<p></p>` is stored as `<p></p>` but formats to
    // `<h1></h1>`, so every empty note would look like a change from another
    // device and reset itself on a loop.
    //
    // Checking the whole ledger rather than just the newest entry is what
    // makes this safe under fast typing -- see echoesRef.
    if (echoesRef.current.has(initialContent)) return;

    const sinceTyping = Date.now() - lastTypedAtRef.current;
    if (sinceTyping > REMOTE_APPLY_IDLE_MS) {
      applyRemote(initialContent);
      return;
    }

    // Held, not dropped -- and held with its OWN timer.
    //
    // Relying on the onChange debounce to flush this was a bug: onChange only
    // fires on a keystroke, so an edit arriving just as the user stopped
    // typing would sit here until they typed again. Which is precisely the
    // common case -- you pause, and that pause is when the other device's
    // text should appear.
    pendingRemoteRef.current = initialContent;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(
      applyPendingRemote,
      REMOTE_APPLY_IDLE_MS - sinceTyping
    );
  }, [initialContent, applyRemote, applyPendingRemote]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  const editorState = useBridgeState(editor);

  // Repaint the WebView when the theme or the bullet marker changes. The
  // document already STARTS with the right values (see initialSchemeRef
  // above), so this covers them being changed while a note is open --
  // switching Appearance -> Bullets from the settings sheet, or the OS
  // crossing sunset while the app sits in Device mode.
  const applyEditorTheme = useCallback(() => {
    // webviewRef.injectJavaScript, not TenTap's editor.injectJS. The latter
    // wraps the string in its own envelope, which changes the script's
    // completion value and makes WKWebView log "Error evaluating
    // injectedJavaScript ... unsupported return type" on every call. The
    // scroll plumbing below already uses this same route for the same reason.
    editor.webviewRef?.current?.injectJavaScript(
      applyEditorThemeJS(scheme, bulletStyle)
    );
  }, [editor, scheme, bulletStyle]);

  useEffect(() => {
    applyEditorTheme();
  }, [applyEditorTheme]);

  const onScrollOffsetChangeRef = useRef(onScrollOffsetChange);
  useEffect(() => {
    onScrollOffsetChangeRef.current = onScrollOffsetChange;
  }, [onScrollOffsetChange]);

  // TenTap renders its WebView with scrollEnabled={false} and scrolls the web
  // document itself, so React Native's onScroll never fires. We instead listen
  // for scroll *inside* the page and post the offset back over the WebView's
  // message channel.
  const installScrollListener = () => {
    editor.webviewRef?.current?.injectJavaScript(`
      ${FIND_SCROLLER_JS}
      (function() {
        if (window.__notesScrollHooked) return true;
        window.__notesScrollHooked = true;
        var post = function(e) {
          // The scrolling node is a container inside the page, not the document,
          // so prefer the event's own target over guessing.
          var el = (e && e.target && e.target.scrollTop != null)
            ? e.target
            : window.__notesFindScroller();
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: '${SCROLL_MESSAGE_TYPE}',
            payload: el ? el.scrollTop : 0
          }));
        };
        // scroll doesn't bubble, but capture-phase on document still sees it
        document.addEventListener('scroll', post, { passive: true, capture: true });
        window.addEventListener('scroll', post, { passive: true });
      })();
      true;
    `);
  };

  // Content arrives over TenTap's own bridge after the page loads, and there's
  // no "content ready" signal — so retry until the document is tall enough.
  const restoreScroll = () => {
    if (!initialScrollOffset) return;

    if (__DEV__) {
      console.warn(
        `[RichEditor] attempting scroll restore to ${initialScrollOffset}px (best-effort)`
      );
    }

    editor.webviewRef?.current?.injectJavaScript(`
      ${FIND_SCROLLER_JS}
      (function() {
        var target = ${initialScrollOffset};
        var attempts = 0;
        var tryScroll = function() {
          attempts++;
          var el = window.__notesFindScroller();
          if (el && el.scrollHeight >= target + el.clientHeight) {
            el.scrollTop = target;
            return;
          }
          if (attempts < 20) setTimeout(tryScroll, 100);
        };
        tryScroll();
      })();
      true;
    `);
  };

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    const raw = event.nativeEvent.data;
    if (typeof raw !== 'string') return;
    try {
      const { type, payload } = JSON.parse(raw);
      if (type === SCROLL_MESSAGE_TYPE) {
        onScrollOffsetChangeRef.current?.(payload);
      }
    } catch {
      // Non-JSON messages belong to TenTap; ignore them here.
    }
  };

  if (!editor) return null;

  const isHeading1Active = editorState.headingLevel === 1;
  const isHeading2Active = editorState.headingLevel === 2;

  return (
    <Box className="flex-1 bg-background flex flex-col">
      {/* Toolbar built with Gluestack UI components.
          ABOVE the canvas, not below it. This is a plain flex column and
          nothing here avoids the keyboard, so a toolbar underneath the text
          was covered by the software keyboard the moment you started typing --
          unreachable exactly when it was wanted. At the top it sits under the
          note's header and stays put. */}
      <Box className="border-b border-border bg-background px-3 py-1.5">
        <HStack className="items-center space-x-1 flex-wrap">
          {/* Bold */}
          <Pressable
            onPress={() => editor.toggleBold()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isBoldActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Bold}
              className={`w-4 h-4 ${
                editorState.isBoldActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Italic */}
          <Pressable
            onPress={() => editor.toggleItalic()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isItalicActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Italic}
              className={`w-4 h-4 ${
                editorState.isItalicActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Strikethrough */}
          <Pressable
            onPress={() => editor.toggleStrike()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isStrikeActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Strikethrough}
              className={`w-4 h-4 ${
                editorState.isStrikeActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-border mx-1" />

          {/* Heading 1 */}
          <Pressable
            onPress={() => editor.toggleHeading(1)}
            className={`p-2 rounded-lg transition-colors ${
              isHeading1Active ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading1}
              className={`w-4 h-4 ${
                isHeading1Active ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Heading 2 */}
          <Pressable
            onPress={() => editor.toggleHeading(2)}
            className={`p-2 rounded-lg transition-colors ${
              isHeading2Active ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading2}
              className={`w-4 h-4 ${
                isHeading2Active ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-border mx-1" />

          {/* Bullet List */}
          <Pressable
            onPress={() => editor.toggleBulletList()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isBulletListActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={List}
              className={`w-4 h-4 ${
                editorState.isBulletListActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Ordered List */}
          <Pressable
            onPress={() => editor.toggleOrderedList()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isOrderedListActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={ListOrdered}
              className={`w-4 h-4 ${
                editorState.isOrderedListActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Outdent / Indent.
              These are the only ENABLED/DISABLED controls in this toolbar --
              everything else is a toggle with an on state to light up, and
              there is no such thing as "currently indenting". So they
              deliberately skip the bg-lime-100 active pill and use opacity
              instead: reusing the pill would claim a state that doesn't
              exist. TenTap exposes canLift/canSink in the bridge state, which
              is what makes the boundaries honest rather than guessed --
              outside a list both go dim, and at the top level only outdent
              does. */}
          <Pressable
            onPress={() => editorState.canLift && editor.lift()}
            disabled={!editorState.canLift}
            className={`p-2 rounded-lg ${editorState.canLift ? '' : 'opacity-30'}`}
          >
            <Icon as={IndentDecrease} className="w-4 h-4 text-muted-foreground" />
          </Pressable>

          <Pressable
            onPress={() => editorState.canSink && editor.sink()}
            disabled={!editorState.canSink}
            className={`p-2 rounded-lg ${editorState.canSink ? '' : 'opacity-30'}`}
          >
            <Icon as={IndentIncrease} className="w-4 h-4 text-muted-foreground" />
          </Pressable>

          <Box className="w-px h-4 bg-border mx-1" />

          {/* Blockquote */}
          <Pressable
            onPress={() => editor.toggleBlockquote()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isBlockquoteActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Quote}
              className={`w-4 h-4 ${
                editorState.isBlockquoteActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Code */}
          <Pressable
            onPress={() => editor.toggleCode()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isCodeActive ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Code}
              className={`w-4 h-4 ${
                editorState.isCodeActive ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>
        </HStack>
      </Box>

      {/* Editor Canvas */}
      <Box className="flex-1">
        <RichText
          editor={editor}
          // The WebView's own surface, which exists before any HTML or CSS
          // does. WKWebView defaults to opaque white, so without this the
          // native view itself is the white flash -- the stylesheet above
          // cannot help, because there is no document yet to style.
          style={{ flex: 1, backgroundColor: EDITOR_COLORS[scheme].bg }}
          onLoadEnd={() => {
            applyEditorTheme();
            installScrollListener();
            restoreScroll();
          }}
          // Must stay false, otherwise TenTap skips its own message handling
          // and the editor bridge stops working.
          exclusivelyUseCustomOnMessage={false}
          onMessage={handleWebViewMessage}
        />
      </Box>
    </Box>
  );
}
