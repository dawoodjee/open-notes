import React, { useRef, useEffect, useMemo } from 'react';
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
} from 'lucide-react-native';

export interface RichEditorProps {
  initialContent?: string;
  onChange?: (html: string) => void;
  autoFocus?: boolean;
  // Accepted so both platform variants share one props contract; scroll
  // persistence is only implemented in RichEditor.native.tsx, since web is
  // out of scope (parked on the web-powersync branch).
  initialScrollOffset?: number;
  onScrollOffsetChange?: (offset: number) => void;
}

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

// Authentic Apple Notes typography forced across all WebView nodes
const editorThemeCSS = `
  * {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body, html {
    margin: 0;
    padding: 0;
    color: #1c1c1e;
    background-color: #fbfbfd;
    font-size: 16px;
    line-height: 1.5;
  }
  .ProseMirror {
    outline: none;
    min-height: 100vh;
    padding: 24px;
  }
  .ProseMirror p {
    margin-top: 0;
    margin-bottom: 0.75rem;
    color: #374151;
  }
  h1 {
    font-size: 1.875rem;
    font-weight: 700;
    color: #111827;
    margin-top: 0;
    margin-bottom: 0.25rem;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #1f2937;
    margin-top: 0.75rem;
    margin-bottom: 0.25rem;
  }
  blockquote {
    border-left: 3px solid #84CC16;
    padding-left: 1rem;
    margin: 0 0 0.75rem 0;
    color: #636366;
    font-style: italic;
  }
  code {
    background-color: #f2f2f7;
    color: #1c1c1e;
    padding: 0.2rem 0.4rem;
    border-radius: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
    font-size: 0.9em;
  }
  ul, ol {
    padding-left: 1.25rem;
    margin-bottom: 0.75rem;
  }
  ::selection {
    background-color: #ECFCCB;
    color: #365314;
  }
`;

export default function RichEditor({
  initialContent = '',
  onChange,
  autoFocus = false,
}: RichEditorProps) {
  const formattedContent = useMemo(
    () => formatInitialContent(initialContent),
    [initialContent]
  );

  const onChangeRef = useRef(onChange);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditorBridge({
    initialContent: formattedContent,
    autofocus: autoFocus,
    bridgeExtensions: [
      ...TenTapStartKit,
      CoreBridge.configureCSS(editorThemeCSS),
      ImageBridge,
    ],
    avoidIosKeyboard: true,
    onChange: () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        if (onChangeRef.current && editor) {
          const html = await editor.getHTML();
          const cleanHtml = sanitizeHtmlOutput(html);
          onChangeRef.current(cleanHtml);
        }
      }, 200);
    },
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const editorState = useBridgeState(editor);

  if (!editor) return null;

  // Active heading states derived from bridge state
  const isHeading1Active = editorState.headingLevel === 1;
  const isHeading2Active = editorState.headingLevel === 2;

  return (
    <Box className="flex-1 bg-background flex flex-col">
      {/* Editor Canvas */}
      <Box className="flex-1">
        <RichText editor={editor} style={{ flex: 1 }} />
      </Box>

      {/* Toolbar built with Gluestack UI components */}
      <Box className="border-t border-gray-100 bg-background px-3 py-1.5">
        <HStack className="items-center space-x-1 flex-wrap">
          {/* Bold */}
          <Pressable
            onPress={() => editor.toggleBold()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isBoldActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Bold}
              className={`w-4 h-4 ${
                editorState.isBoldActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          {/* Italic */}
          <Pressable
            onPress={() => editor.toggleItalic()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isItalicActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Italic}
              className={`w-4 h-4 ${
                editorState.isItalicActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          {/* Strikethrough */}
          <Pressable
            onPress={() => editor.toggleStrike()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isStrikeActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Strikethrough}
              className={`w-4 h-4 ${
                editorState.isStrikeActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-gray-200 mx-1" />

          {/* Heading 1 */}
          <Pressable
            onPress={() => editor.toggleHeading(1)}
            className={`p-2 rounded-lg transition-colors ${
              isHeading1Active ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading1}
              className={`w-4 h-4 ${
                isHeading1Active ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          {/* Heading 2 */}
          <Pressable
            onPress={() => editor.toggleHeading(2)}
            className={`p-2 rounded-lg transition-colors ${
              isHeading2Active ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Heading2}
              className={`w-4 h-4 ${
                isHeading2Active ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          <Box className="w-px h-4 bg-gray-200 mx-1" />

          {/* Bullet List */}
          <Pressable
            onPress={() => editor.toggleBulletList()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isBulletListActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={List}
              className={`w-4 h-4 ${
                editorState.isBulletListActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          {/* Ordered List */}
          <Pressable
            onPress={() => editor.toggleOrderedList()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isOrderedListActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={ListOrdered}
              className={`w-4 h-4 ${
                editorState.isOrderedListActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          {/* Blockquote */}
          <Pressable
            onPress={() => editor.toggleBlockquote()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isBlockquoteActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Quote}
              className={`w-4 h-4 ${
                editorState.isBlockquoteActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>

          {/* Code */}
          <Pressable
            onPress={() => editor.toggleCode()}
            className={`p-2 rounded-lg transition-colors ${
              editorState.isCodeActive ? 'bg-lime-100' : 'bg-transparent'
            }`}
          >
            <Icon
              as={Code}
              className={`w-4 h-4 ${
                editorState.isCodeActive ? 'text-lime-700' : 'text-gray-600'
              }`}
            />
          </Pressable>
        </HStack>
      </Box>
    </Box>
  );
}
