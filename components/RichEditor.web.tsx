import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Pressable } from '@/components/ui/pressable';
import { Icon } from '@/components/ui/icon';
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

/** See the note of the same name in RichEditor.native.tsx. */
const REMOTE_APPLY_IDLE_MS = 1500;

// See RichEditor.native.tsx for why the ledger is bounded, and at what.
const MAX_ECHO_HISTORY = 50;

export interface RichEditorProps {
  initialContent?: string;
  onChange?: (html: string) => void;
  autoFocus?: boolean;
}

// 1. Force top line to strictly be a Heading node
const AppleNotesDocument = Document.extend({
  content: 'heading block*',
});

// 2. Custom Heading: Cleanly splits heading into paragraph on Enter using transactions
const AppleNotesHeading = Heading.extend({
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        if ($from.parent.type.name === 'heading') {
          return editor
            .chain()
            .splitBlock()
            .command(({ tr, state }) => {
              const { $to } = state.selection;
              const pos = $to.before();
              const node = state.doc.nodeAt(pos);
              if (node && node.type.name === 'heading') {
                tr.setNodeMarkup(pos, state.schema.nodes.paragraph);
              }
              return true;
            })
            .unsetAllMarks()
            .run();
        }

        return false;
      },
    };
  },
});

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

export default function RichEditor({
  initialContent = '',
  onChange,
  autoFocus = false,
}: RichEditorProps) {
  const formattedContent = React.useMemo(
    () => formatInitialContent(initialContent),
    [initialContent]
  );

  // Same refs, and the same reasoning, as RichEditor.native.tsx: the editor's
  // content is set once at construction, so a note open on another device
  // never updated here either.
  //
  // The ledger carries the same fix as native, and matters MORE here: onUpdate
  // below has no debounce at all, so this editor emits on every keystroke and
  // therefore has more saves in flight at once. Comparing an incoming body
  // against only the newest emission would misread the older ones as remote
  // edits and ping-pong the document. See the long note in the native file.
  const echoesRef = React.useRef<Map<string, true>>(
    new Map([[initialContent, true]])
  );
  const lastTypedAtRef = React.useRef<number>(0);
  const pendingRemoteRef = React.useRef<string | null>(null);

  const rememberEcho = React.useCallback((html: string) => {
    const ledger = echoesRef.current;
    ledger.delete(html);
    ledger.set(html, true);
    if (ledger.size > MAX_ECHO_HISTORY) {
      ledger.delete(ledger.keys().next().value as string);
    }
  }, []);

  const editor = useEditor({
    autofocus: autoFocus ? 'start' : false,
    extensions: [
      StarterKit.configure({
        document: false,
        heading: false,
      }),
      AppleNotesDocument,
      AppleNotesHeading.configure({
        levels: [1, 2, 3],
      }),
    ],
    content: formattedContent,
    onUpdate: ({ editor }) => {
      lastTypedAtRef.current = Date.now();
      const cleanHtml = sanitizeHtmlOutput(editor.getHTML());
      rememberEcho(cleanHtml);
      if (onChange) onChange(cleanHtml);
    },
  });

  React.useEffect(() => {
    if (!editor) return;
    if (echoesRef.current.has(initialContent)) return;

    const apply = (raw: string) => {
      pendingRemoteRef.current = null;
      rememberEcho(raw);
      // emitUpdate: false, so applying a remote edit isn't mistaken for a
      // local one and echoed straight back out.
      editor.commands.setContent(formatInitialContent(raw), { emitUpdate: false });
    };

    const sinceTyping = Date.now() - lastTypedAtRef.current;
    if (sinceTyping > REMOTE_APPLY_IDLE_MS) {
      apply(initialContent);
      return;
    }

    // Held with its own self-rescheduling timer, which re-checks that typing
    // has actually stopped rather than trusting the delay it was scheduled
    // with. See the fuller note in RichEditor.native.tsx.
    pendingRemoteRef.current = initialContent;
    let timer: ReturnType<typeof setTimeout>;
    const flush = () => {
      const pending = pendingRemoteRef.current;
      if (pending === null) return;
      const idleFor = Date.now() - lastTypedAtRef.current;
      if (idleFor >= REMOTE_APPLY_IDLE_MS) apply(pending);
      else timer = setTimeout(flush, REMOTE_APPLY_IDLE_MS - idleFor);
    };
    timer = setTimeout(flush, REMOTE_APPLY_IDLE_MS - sinceTyping);
    return () => clearTimeout(timer);
  }, [initialContent, editor]);

  if (!editor) return null;

  const canSink = editor.can().sinkListItem('listItem');
  const canLift = editor.can().liftListItem('listItem');

  return (
    <Box className="flex-1 bg-background flex flex-col">
      {/* Editor Canvas with tightened vertical margins */}
      <Box className="flex-1 overflow-y-auto p-6">
        <EditorContent
          editor={editor}
          className="prose max-w-none min-h-full font-sans text-foreground
            [&_.ProseMirror]:outline-none [&_.ProseMirror]:ring-0
            [&_.ProseMirror_h1]:text-3xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:text-foreground [&_.ProseMirror_h1]:mt-0 [&_.ProseMirror_h1]:mb-1
            [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-foreground [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-1
            [&_.ProseMirror_p]:text-base [&_.ProseMirror_p]:text-muted-foreground [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:my-1"
        />
      </Box>

      {/* Toolbar */}
      <Box className="border-t border-border bg-background px-3 py-1.5">
        <HStack className="items-center space-x-1 flex-wrap">
          <Pressable
            onPress={() => editor.chain().focus().toggleBold().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('bold') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Bold}
              className={`w-4 h-4 ${
                editor.isActive('bold') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleItalic().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('italic') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Italic}
              className={`w-4 h-4 ${
                editor.isActive('italic') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleStrike().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('strike') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Strikethrough}
              className={`w-4 h-4 ${
                editor.isActive('strike') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-border mx-1" />

          <Pressable
            onPress={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('heading', { level: 1 }) ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading1}
              className={`w-4 h-4 ${
                editor.isActive('heading', { level: 1 }) ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('heading', { level: 2 }) ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading2}
              className={`w-4 h-4 ${
                editor.isActive('heading', { level: 2 }) ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-border mx-1" />

          <Pressable
            onPress={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('bulletList') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={List}
              className={`w-4 h-4 ${
                editor.isActive('bulletList') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('orderedList') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={ListOrdered}
              className={`w-4 h-4 ${
                editor.isActive('orderedList') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          {/* Outdent / Indent -- enabled/disabled rather than toggled. See
              the fuller note in RichEditor.native.tsx. */}
          <Pressable
            onPress={() => editor.chain().focus().liftListItem('listItem').run()}
            disabled={!canLift}
            className={`p-2 rounded-lg ${canLift ? '' : 'opacity-30'}`}
          >
            <Icon as={IndentDecrease} className="w-4 h-4 text-muted-foreground" />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().sinkListItem('listItem').run()}
            disabled={!canSink}
            className={`p-2 rounded-lg ${canSink ? '' : 'opacity-30'}`}
          >
            <Icon as={IndentIncrease} className="w-4 h-4 text-muted-foreground" />
          </Pressable>

          <Box className="w-px h-4 bg-border mx-1" />

          <Pressable
            onPress={() => editor.chain().focus().toggleBlockquote().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('blockquote') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Quote}
              className={`w-4 h-4 ${
                editor.isActive('blockquote') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleCode().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('code') ? 'bg-lime-100 dark:bg-lime-900/40' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Code}
              className={`w-4 h-4 ${
                editor.isActive('code') ? 'text-lime-700 dark:text-lime-400' : 'text-muted-foreground'
              }`}
            />
          </Pressable>
        </HStack>
      </Box>
    </Box>
  );
}
