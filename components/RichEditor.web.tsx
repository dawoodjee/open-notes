import React, { useMemo } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';

import { stripEnrichedWrapper } from '@/lib/notes/htmlMigrate';
import type { RichEditorProps } from './RichEditor';

/**
 * WEB PLACEHOLDER. Read-only, and deliberately so.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Web did not boot, and Stage 12b's job was to get it booting far enough to
 * verify the desktop chrome. The blocker turned out NOT to be the
 * `Appearance.setColorScheme` failure that was recorded against it -- that one
 * is real but comes later. The first thing to break is a BROKEN npm HOIST
 * introduced with the new editor in Stage 11.5:
 *
 *   node_modules/@tiptap/extension-history        <- hoisted to the top level
 *   node_modules/react-native-enriched-html/
 *     node_modules/@tiptap/extensions             <- NOT hoisted
 *
 * `extension-history` requires `@tiptap/extensions`. From the top level that
 * resolves to `node_modules/@tiptap/extensions`, which does not exist, so the
 * web bundle dies with:
 *
 *   TransformError: ENOENT: no such file or directory, open
 *   '.../node_modules/@tiptap/extensions/dist/index.js'
 *
 * `npm dedupe` does not fix it. Native never hits this because the whole
 * `@tiptap` chain belongs to `react-native-enriched-html`'s WEB
 * implementation -- on iOS and Android the editor is genuinely native and
 * none of it is bundled.
 *
 * ── WHY A STUB RATHER THAN A FIX ──────────────────────────────────────────
 *
 * Untangling npm's hoisting -- or pinning a transitive dependency of someone
 * else's package into our own manifest -- is a dependency-tree decision, and
 * this sub-phase's whole scope is "guard what throws at startup, decide
 * nothing architectural". The library's own web support is marked
 * experimental, and Stage 13 owns what the web editor actually is. Fixing the
 * hoist here would mean committing a lockfile change with an unclear blast
 * radius immediately before a native rebuild, in service of a pane Stage 13 is
 * going to revisit anyway.
 *
 * Metro resolves `.web.tsx` ahead of `.tsx`, so this file alone keeps the
 * entire `@tiptap` chain out of the web bundle. No dependency changed.
 *
 * ── WHAT THIS COSTS, PLAINLY ──────────────────────────────────────────────
 *
 * Notes are READ-ONLY on web until Stage 13. Editing, formatting and the echo
 * ledger all live in RichEditor.tsx and none of it runs here. `onChange` is
 * accepted and never called, which is the honest shape: there is nothing to
 * report because nothing can change.
 *
 * It is still the right thing for Stage 12c to verify against -- the desktop
 * chrome floats OVER a scrolling document and must not overlap the title until
 * you scroll, and that needs real note text of real length, which this gives.
 */
export default function RichEditor({ initialContent = '' }: RichEditorProps) {
  /**
   * Tags are stripped rather than rendered. `dangerouslySetInnerHTML` would
   * put unsanitised stored HTML into the DOM, and a note's body is the one
   * string in this app most likely to contain markup that came from somewhere
   * else -- a paste, an import, another client. Read-only plain text costs a
   * placeholder its formatting; the alternative costs an XSS.
   */
  const text = useMemo(() => {
    const body = stripEnrichedWrapper(initialContent);
    return body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, [initialContent]);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16 }}>
      <View className="mb-3 self-start rounded-full bg-foreground/10 px-3 py-1">
        <RNText className="text-xs text-muted-foreground">Read-only on web until Stage 13</RNText>
      </View>
      <RNText className="text-base text-foreground" selectable>
        {text}
      </RNText>
    </ScrollView>
  );
}
