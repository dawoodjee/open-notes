import { parseHtml, textContent, type HtmlElement, type HtmlNode } from './htmlTree';

/**
 * A note body (the editor's HTML) as Markdown, for export.
 *
 * ── WHY THIS DIRECTION IS HAND-ROLLED WHEN IMPORT USES `marked` ───────────
 *
 * The input is closed: `react-native-enriched-html` stores a dozen tags, all
 * measured (see the Stage 15 checklist in the build plan). Owning a converter
 * over a known set is what lets export guarantee fidelity -- every construct
 * the editor can produce has a line below, and a test. Import is the opposite
 * problem (arbitrary Markdown from other apps), which is why it gets a real
 * parser instead.
 *
 * ── THE PART THAT IS EASY TO GET WRONG: ESCAPING ──────────────────────────
 *
 * The editor stores Markdown punctuation typed as text LITERALLY -- a note that
 * says "*important*" holds those asterisks as characters, not as italics.
 * Written out unescaped, that note re-imports as italics and the asterisks are
 * gone. Same for a line starting "1." (becomes a list), "#" (a heading) or ">"
 * (a quote). So text is escaped twice over: character escapes everywhere
 * (escapeInline), and block-start escapes per rendered line (escapeLineStart).
 *
 * The second is a post-check on finished lines, which is only safe because of
 * a property worth stating: no marker this file emits (`**`, `*`, `~~`, `` ` ``,
 * `[`, `![`, `<u>`) starts with `#`, `>`, `-`, `+` or a digit. So a finished
 * line that starts with one of those started with the user's own text.
 *
 * ── WHAT DOES NOT SURVIVE, STATED ─────────────────────────────────────────
 *
 * - Underline has no Markdown syntax; it is written as inline `<u>…</u>`
 *   (Adam, 2026-09-28 -- see the Decisions Log). Loses nothing.
 * - Empty lines between blocks (the editor's top-level `<br>`) collapse:
 *   Markdown treats blank lines as separators, not content.
 * - Any tag outside the editor's set keeps its TEXT and loses its formatting,
 *   and is reported in `unmappedTags` rather than dropped silently.
 */

export interface MarkdownResult {
  markdown: string;
  /** Tag names that had no Markdown form and were reduced to their text. */
  unmappedTags: string[];
}

interface Ctx {
  unmapped: Set<string>;
}

/** Tags that are formatting-free wrappers: descend into them without comment. */
const TRANSPARENT = new Set(['html', 'body', 'div', 'span', 'section', 'article', 'main', 'label']);

export function htmlToMarkdown(body: string): MarkdownResult {
  const ctx: Ctx = { unmapped: new Set() };
  const blocks = renderBlocks(parseHtml(body), ctx);
  const markdown = blocks.join('\n\n').trim();
  return {
    markdown: markdown ? markdown + '\n' : '',
    unmappedTags: [...ctx.unmapped].sort(),
  };
}

// ─── Blocks ───────────────────────────────────────────────────────────────

function renderBlocks(nodes: HtmlNode[], ctx: Ctx): string[] {
  const out: string[] = [];
  // Bare inline content at block level (text, or a <b> with no <p> around it,
  // which legacy bodies do contain) is gathered into one paragraph rather than
  // each fragment becoming its own.
  let pendingInline: HtmlNode[] = [];
  const flushInline = () => {
    const line = paragraph(pendingInline, ctx);
    if (line) out.push(line);
    pendingInline = [];
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      // Whitespace between blocks -- the newlines native wraps blocks in.
      if (node.text.trim()) pendingInline.push(node);
      continue;
    }
    if (isInline(node)) {
      pendingInline.push(node);
      continue;
    }
    flushInline();
    out.push(...renderBlock(node, ctx));
  }
  flushInline();
  return out;
}

const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'a', 'img', 'span']);
function isInline(node: HtmlElement): boolean {
  return INLINE_TAGS.has(node.tag);
}

function renderBlock(node: HtmlElement, ctx: Ctx): string[] {
  const tag = node.tag;

  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    const text = renderInline(node.children, ctx).trim();
    // An empty heading is what every new note is seeded with -- nothing to say.
    return text ? ['#'.repeat(Number(heading[1])) + ' ' + text] : [];
  }

  switch (tag) {
    case 'p': {
      const line = paragraph(node.children, ctx);
      return line ? [line] : [];
    }
    case 'br':
    case 'hr':
      // A top-level <br> is the editor's empty line; blank lines are already
      // how Markdown separates blocks. <hr> never comes from this editor.
      return tag === 'hr' ? ['---'] : [];
    case 'ul':
    case 'ol':
      return [renderList(node, ctx, 0)].filter(Boolean);
    case 'blockquote': {
      const inner = renderBlocks(node.children, ctx).join('\n\n');
      if (!inner.trim()) return [];
      return [inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')];
    }
    case 'codeblock':
    case 'pre':
      return [codeFence(codeLines(node))];
    case 'li':
      // A list item outside any list: keep it as a paragraph.
      return renderBlocks(node.children, ctx);
    default:
      if (!TRANSPARENT.has(tag)) ctx.unmapped.add(tag);
      return renderBlocks(node.children, ctx);
  }
}

function paragraph(children: HtmlNode[], ctx: Ctx): string {
  const text = renderInline(children, ctx).trim();
  if (!text) return '';
  return text.split('\n').map(escapeLineStart).join('\n');
}

/**
 * Lists, nested by indentation.
 *
 * The editor itself only makes flat lists, but pre-11.5 bodies can hold nested
 * ones, and Markdown can represent nesting faithfully -- so it is written out
 * rather than flattened here. (Re-importing flattens it, because the editor
 * does; that is the editor's limit, not export's.)
 */
function renderList(list: HtmlElement, ctx: Ctx, depth: number): string {
  const isChecklist = list.attrs['data-type'] === 'checkbox' || list.attrs['data-type'] === 'taskList';
  const ordered = list.tag === 'ol';
  let n = ordered ? Number.parseInt(list.attrs.start ?? '1', 10) || 1 : 0;
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  for (const item of list.children) {
    if (item.type !== 'element') {
      if (item.text.trim()) lines.push(indent + '- ' + escapeInline(item.text.trim()));
      continue;
    }
    if (item.tag === 'ul' || item.tag === 'ol') {
      lines.push(renderList(item, ctx, depth + 1));
      continue;
    }

    const inline: HtmlNode[] = [];
    const nested: HtmlElement[] = [];
    for (const child of item.children) {
      if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) nested.push(child);
      else if (child.type === 'element' && child.tag === 'p') inline.push(...child.children);
      else inline.push(child);
    }

    const checked = 'checked' in item.attrs || item.attrs['data-checked'] === 'true';
    const marker = ordered ? `${n++}. ` : isChecklist ? (checked ? '- [x] ' : '- [ ] ') : '- ';
    // A list item's own text never needs block-start escaping: the marker
    // already occupies the start of the line.
    const text = renderInline(inline, ctx).trim().replace(/\n/g, ' ');
    lines.push(indent + marker + text);
    for (const sub of nested) lines.push(renderList(sub, ctx, depth + 1));
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * The lines of a code block, verbatim.
 *
 * `<codeblock>` stores one `<p>` per line (measured); legacy `<pre><code>`
 * stores one text node with newlines. No escaping inside a fence -- that is
 * the point of a fence.
 */
function codeLines(node: HtmlElement): string[] {
  const paragraphs = node.children.filter(
    (c): c is HtmlElement => c.type === 'element' && c.tag === 'p'
  );
  if (paragraphs.length) return paragraphs.map((p) => textContent(p));
  return textContent(node).replace(/^\n/, '').replace(/\n$/, '').split('\n');
}

function codeFence(lines: string[]): string {
  const body = lines.join('\n');
  // A fence must be longer than any backtick run inside it, or the code's own
  // ``` would close the block early.
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}`;
}

// ─── Inline ───────────────────────────────────────────────────────────────

function renderInline(nodes: HtmlNode[], ctx: Ctx): string {
  let out = '';
  nodes.forEach((node, index) => {
    if (node.type === 'text') {
      // Source newlines in HTML text are just whitespace.
      out += escapeInline(node.text.replace(/\s*\n\s*/g, ' '), nodes, index);
      return;
    }
    out += renderInlineElement(node, ctx);
  });
  return out;
}

function renderInlineElement(node: HtmlElement, ctx: Ctx): string {
  const inner = () => renderInline(node.children, ctx);
  switch (node.tag) {
    case 'b':
    case 'strong':
      return wrap(inner(), '**');
    case 'i':
    case 'em':
      return wrap(inner(), '*');
    case 's':
    case 'strike':
    case 'del':
      return wrap(inner(), '~~');
    case 'u':
    case 'ins':
      // No Markdown form; inline HTML round-trips. See the header.
      return wrap(inner(), '<u>', '</u>');
    case 'code':
      return inlineCode(textContent(node));
    case 'a': {
      const text = inner();
      const href = node.attrs.href ?? '';
      if (!href) return text;
      return `[${text || escapeInline(href)}](${linkTarget(href)})`;
    }
    case 'img': {
      const src = node.attrs.src ?? '';
      if (!src) return '';
      return `![${escapeInline(node.attrs.alt ?? '')}](${linkTarget(src)})`;
    }
    case 'br':
      // CommonMark's hard line break.
      return '\\\n';
    case 'input':
      // A legacy task-list checkbox; the item's checked state is on the <li>.
      return '';
    default:
      if (!TRANSPARENT.has(node.tag)) ctx.unmapped.add(node.tag);
      return inner();
  }
}

/**
 * Emphasis markers, with whitespace moved OUTSIDE them.
 *
 * CommonMark only recognises `**bold**` when the markers touch non-space text,
 * so a selection that included a trailing space -- `<b>bold </b>` -- written
 * naively as `**bold **` re-imports as literal asterisks. Moving the space out
 * keeps it and keeps the formatting.
 */
function wrap(inner: string, open: string, close: string = open): string {
  const trimmed = inner.trim();
  if (!trimmed) return inner;
  const lead = inner.slice(0, inner.length - inner.trimStart().length);
  const trail = inner.slice(inner.trimEnd().length);
  return `${lead}${open}${trimmed}${close}${trail}`;
}

function inlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  // A code span that starts or ends with a backtick needs a space of padding,
  // which CommonMark strips back off.
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A URL safe to put inside `( )`. Angle brackets allow spaces and parens. */
function linkTarget(url: string): string {
  if (!/[\s()<>]/.test(url)) return url;
  return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

/**
 * Escape Markdown punctuation in user text.
 *
 * `_` is the one that is left alone when it sits INSIDE a word: CommonMark never
 * treats an intraword underscore as emphasis, so `snake_case` is safe as
 * written and `snake\_case` would only be noise in the file. At a word edge it
 * can open or close emphasis, so it is escaped there.
 */
export function escapeInline(text: string, siblings?: HtmlNode[], index?: number): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : neighbourChar(siblings, index, -1);
    const next = i < text.length - 1 ? text[i + 1] : neighbourChar(siblings, index, 1);
    switch (ch) {
      case '\\':
      case '`':
      case '*':
      case '[':
      case ']':
      case '<':
      case '~':
        out += '\\' + ch;
        break;
      case '_':
        out += isWordChar(prev) && isWordChar(next) ? '_' : '\\_';
        break;
      case '&':
        // Only where it would otherwise be read as an entity: "&copy;" typed
        // as text must not come back as ©.
        out += /^&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/i.test(text.slice(i)) ? '\\&' : '&';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

/** The character just outside this text node, for the `_` rule above. */
function neighbourChar(siblings: HtmlNode[] | undefined, index: number | undefined, dir: -1 | 1): string | undefined {
  if (!siblings || index === undefined) return undefined;
  const neighbour = siblings[index + dir];
  if (!neighbour) return undefined;
  const text = textContent(neighbour);
  return dir === -1 ? text[text.length - 1] : text[0];
}

/**
 * Escape the ways a line's own first characters could be read as structure.
 *
 * See the header for why a post-check on a finished line is safe.
 */
export function escapeLineStart(line: string): string {
  // Four or more leading spaces is an indented code block; leading spaces are
  // written as entities, which Markdown decodes back to spaces.
  const leading = /^ +/.exec(line)?.[0] ?? '';
  if (leading.length >= 4) line = '&#32;'.repeat(leading.length) + line.slice(leading.length);
  if (/^#{1,6}(\s|$)/.test(line)) return '\\' + line;
  if (/^>/.test(line)) return '\\' + line;
  if (/^[-+](\s|$)/.test(line)) return '\\' + line;
  // A thematic break: three or more of the same -, * or _ and nothing else.
  if (/^([-*_])(\s*\1){2,}\s*$/.test(line)) return '\\' + line;
  // "1. " or "1) " -- escape the punctuation, not the number.
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line);
  if (ordered) return ordered[1] + '\\' + line.slice(ordered[1].length);
  // "===" alone would turn the line above into a heading.
  if (/^=+\s*$/.test(line)) return '\\' + line;
  return line;
}
