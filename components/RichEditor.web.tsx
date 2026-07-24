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
} from 'lucide-react-native';

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
      if (onChange) {
        const cleanHtml = sanitizeHtmlOutput(editor.getHTML());
        onChange(cleanHtml);
      }
    },
  });

  if (!editor) return null;

  return (
    <Box className="flex-1 bg-white flex flex-col">
      {/* Editor Canvas with tightened vertical margins */}
      <Box className="flex-1 overflow-y-auto p-6">
        <EditorContent
          editor={editor}
          className="prose max-w-none min-h-full font-sans text-gray-900
            [&_.ProseMirror]:outline-none [&_.ProseMirror]:ring-0
            [&_.ProseMirror_h1]:text-3xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:text-gray-900 [&_.ProseMirror_h1]:mt-0 [&_.ProseMirror_h1]:mb-1
            [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-gray-800 [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-1
            [&_.ProseMirror_p]:text-base [&_.ProseMirror_p]:text-gray-700 [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:my-1"
        />
      </Box>

      {/* Toolbar */}
      <Box className="border-t border-gray-100 bg-white px-3 py-1.5">
        <HStack className="items-center space-x-1 flex-wrap">
          <Pressable
            onPress={() => editor.chain().focus().toggleBold().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('bold') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Bold}
              className={`w-4 h-4 ${
                editor.isActive('bold') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleItalic().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('italic') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Italic}
              className={`w-4 h-4 ${
                editor.isActive('italic') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleStrike().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('strike') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Strikethrough}
              className={`w-4 h-4 ${
                editor.isActive('strike') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-gray-200 mx-1" />

          <Pressable
            onPress={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('heading', { level: 1 }) ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading1}
              className={`w-4 h-4 ${
                editor.isActive('heading', { level: 1 }) ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('heading', { level: 2 }) ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading2}
              className={`w-4 h-4 ${
                editor.isActive('heading', { level: 2 }) ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-gray-200 mx-1" />

          <Pressable
            onPress={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('bulletList') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={List}
              className={`w-4 h-4 ${
                editor.isActive('bulletList') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('orderedList') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={ListOrdered}
              className={`w-4 h-4 ${
                editor.isActive('orderedList') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleBlockquote().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('blockquote') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Quote}
              className={`w-4 h-4 ${
                editor.isActive('blockquote') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Pressable
            onPress={() => editor.chain().focus().toggleCode().run()}
            className={`p-2 rounded-lg transition-colors ${
              editor.isActive('code') ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Code}
              className={`w-4 h-4 ${
                editor.isActive('code') ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>
        </HStack>
      </Box>
    </Box>
  );
}
