import { marked } from 'marked';

import { escapeAttr, escapeHtml, parseHtml, textContent, type HtmlElement, type HtmlNode } from './htmlTree';

/**
 * Markdown (from our own export, or from any other app) into a note body the
 * editor can open.
 *
 * Two stages, deliberately separate:
 *
 *   1. `marked` turns Markdown into standard HTML. A real parser, because this
 *      input is ARBITRARY -- Obsidian, Bear and friends write tables, nested
 *      lists, reference links and setext headings, which is exactly where a
 *      hand-rolled parser silently loses content.
 *   2. `normalise` walks that HTML down to the dialect the editor stores
 *      (measured -- see the Stage 15 checklist): `<b>` not `<strong>`,
 *      `<codeblock><p>` not `<pre><code>`, `<ul data-type="checkbox">` with
 *      `<li checked>` for task lists, one block per line.
 *
 * ── STAGE 2 IS ALSO THE SECURITY BOUNDARY ─────────────────────────────────
 *
 * `marked` does not sanitise. Measured: `[x](javascript:alert(1))` comes out
 * as a live `javascript:` link and `<img src=x onerror=alert(1)>` passes
 * through verbatim. An imported zip is untrusted input, and on web a
 * `javascript:` href runs when clicked. So `normalise` is an ALLOWLIST --
 * only the editor's own tags survive, each with only the attributes the editor
 * uses, and URLs only with a safe scheme. Everything else is unwrapped to its
 * text. An allowlist fails closed; a blocklist fails open the first time
 * somebody finds a tag it forgot.
 *
 * ── WHAT DEGRADES, AND HOW ────────────────────────────────────────────────
 *
 * The editor cannot represent everything Markdown can. The rule from the
 * Stage 15 prompt is "degrade to plain text rather than drop":
 *   - nested lists flatten into their parent list (the editor is one level);
 *   - tables become one paragraph per row, cells joined by " | ";
 *   - a horizontal rule becomes a paragraph reading "---";
 *   - headings, lists and code inside a blockquote become quoted paragraphs;
 *   - an image with an unsafe source becomes its alt text.
 * Each of these is counted in `degraded`, so an import can say so.
 */

export interface HtmlResult {
  /** A body ready to store, or '' when the Markdown had no content. */
  html: string;
  /** Human-readable names of constructs that had to be simplified. */
  degraded: string[];
}

interface Ctx {
  degraded: Set<string>;
}

export function markdownToHtml(markdown: string): HtmlResult {
  const raw = marked.parse(markdown, { gfm: true, async: false }) as string;
  const ctx: Ctx = { degraded: new Set() };
  const blocks = normaliseBlocks(parseHtml(raw), ctx);
  return {
    // One block per line, newline-wrapped: the native parser is line-oriented,
    // and two blocks sharing a line cost the second its inline formatting
    // (see lib/notes/htmlMigrate.ts).
    html: blocks.length ? `<html>\n${blocks.join('\n')}\n</html>` : '',
    degraded: [...ctx.degraded].sort(),
  };
}

// ─── URLs ─────────────────────────────────────────────────────────────────

/** Link targets: web, mail, phone, or a relative path. Never script or data. */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  // Browsers ignore control characters and whitespace inside a scheme, so
  // "java\tscript:" is javascript:. Strip them before looking at the scheme.
  const probe = trimmed.replace(/[\u0000- ]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(probe)?.[1];
  if (!scheme) return trimmed; // relative
  return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? trimmed : null;
}

/** Image sources: web only. A data: URI can be megabytes and a script vector. */
function safeImageSrc(src: string | undefined): string | null {
  if (!src) return null;
  const probe = src.trim().replace(/[\u0000- ]/g, '').toLowerCase();
  return /^https?:/.test(probe) ? src.trim() : null;
}

// ─── Blocks ───────────────────────────────────────────────────────────────

function normaliseBlocks(nodes: HtmlNode[], ctx: Ctx): string[] {
  const out: string[] = [];
  let pendingInline: HtmlNode[] = [];
  const flush = () => {
    out.push(...paragraphs(pendingInline, ctx));
    pendingInline = [];
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.text.trim()) pendingInline.push(node);
      continue;
    }
    if (INLINE.has(node.tag)) {
      pendingInline.push(node);
      continue;
    }
    flush();
    out.push(...normaliseBlock(node, ctx));
  }
  flush();
  return out;
}

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'del', 'strike', 'code', 'a', 'img', 'br', 'span']);

function normaliseBlock(node: HtmlElement, ctx: Ctx): string[] {
  const heading = /^h([1-6])$/.exec(node.tag);
  if (heading) {
    const inner = inline(node.children, ctx).replace(/<br>/g, ' ');
    return inner.trim() ? [`<h${heading[1]}>${inner}</h${heading[1]}>`] : [];
  }

  switch (node.tag) {
    case 'p':
      return paragraphs(node.children, ctx);
    case 'ul':
    case 'ol':
      return [list(node, ctx)].filter(Boolean);
    case 'blockquote': {
      const inner = quoteParagraphs(node.children, ctx);
      return inner.length ? [`<blockquote>${inner.join('')}</blockquote>`] : [];
    }
    case 'pre':
      return [codeBlock(node)];
    case 'hr':
      ctx.degraded.add('horizontal rule');
      return ['<p>---</p>'];
    case 'table':
      ctx.degraded.add('table');
      return tableRows(node, ctx);
    default:
      // div, section, raw HTML blocks from the Markdown: keep the content,
      // lose the wrapper.
      return normaliseBlocks(node.children, ctx);
  }
}

/**
 * Inline content as one or more `<p>`s.
 *
 * A `<br>` splits the paragraph, because that is what the editor does with one
 * itself (measured: `<p>one<br>two</p>` is stored as two paragraphs).
 */
function paragraphs(nodes: HtmlNode[], ctx: Ctx): string[] {
  return inline(nodes, ctx)
    .split('<br>')
    .map((part) => part.trim())
    .filter((part) => part.replace(/<[^>]+>/g, '').trim() || /<img /.test(part))
    .map((part) => `<p>${part}</p>`);
}

/**
 * Lists, flattened to the editor's one level.
 *
 * A list with ANY task item becomes a checklist: `marked` renders GitHub task
 * items as a plain `<ul>` with an `<input type=checkbox>` inside each `<li>`
 * (measured), and the editor's checklist is a list-level property, not an
 * item-level one.
 */
function list(node: HtmlElement, ctx: Ctx): string {
  const items: { html: string; checked: boolean; isTask: boolean }[] = [];

  const collect = (listNode: HtmlElement, depth: number) => {
    for (const item of listNode.children) {
      if (item.type !== 'element' || item.tag !== 'li') continue;
      const checkbox = findCheckbox(item);
      const inlineParts: HtmlNode[] = [];
      const nested: HtmlElement[] = [];
      for (const child of item.children) {
        if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) nested.push(child);
        else if (child.type === 'element' && child.tag === 'p') inlineParts.push(...child.children, { type: 'text', text: ' ' });
        else if (child.type === 'element' && child.tag === 'input') continue;
        else inlineParts.push(child);
      }
      const html = inline(inlineParts, ctx).replace(/<br>/g, ' ').trim();
      items.push({ html, checked: checkbox?.checked ?? false, isTask: !!checkbox });
      if (nested.length && depth === 0) ctx.degraded.add('nested list');
      for (const sub of nested) collect(sub, depth + 1);
    }
  };
  collect(node, 0);

  if (!items.length) return '';
  const isChecklist = items.some((i) => i.isTask);
  const open = isChecklist ? '<ul data-type="checkbox">' : node.tag === 'ol' ? '<ol>' : '<ul>';
  const close = isChecklist || node.tag !== 'ol' ? '</ul>' : '</ol>';
  const lis = items
    .map((i) => (isChecklist && i.checked ? `<li checked>${i.html}</li>` : `<li>${i.html}</li>`))
    .join('');
  return open + lis + close;
}

function findCheckbox(item: HtmlElement): { checked: boolean } | null {
  for (const child of item.children) {
    if (child.type !== 'element') continue;
    if (child.tag === 'input' && child.attrs.type === 'checkbox') return { checked: 'checked' in child.attrs };
    // Loose task lists put the checkbox inside the item's <p>.
    if (child.tag === 'p') {
      const inner = findCheckbox(child);
      if (inner) return inner;
    }
  }
  return null;
}

/** The editor's blockquote holds paragraphs only; anything richer is flattened. */
function quoteParagraphs(nodes: HtmlNode[], ctx: Ctx): string[] {
  const out: string[] = [];
  for (const block of normaliseBlocks(nodes, ctx)) {
    if (block.startsWith('<p>')) {
      out.push(block);
      continue;
    }
    ctx.degraded.add('formatting inside a quote');
    // Lists become one quoted paragraph per item; anything else, its text.
    const tree = parseHtml(block);
    const items = collectListItems(tree);
    if (items.length) out.push(...items.map((li) => `<p>${li}</p>`));
    else {
      const text = tree.map(textContent).join(' ').trim();
      if (text) out.push(`<p>${escapeHtml(text)}</p>`);
    }
  }
  return out;
}

function collectListItems(nodes: HtmlNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.tag === 'li') out.push(escapeHtml(textContent(node).trim()));
    else out.push(...collectListItems(node.children));
  }
  return out;
}

/**
 * `<pre><code>` into the editor's `<codeblock>`, one `<p>` per line.
 *
 * Leading indentation is written through, but the editor strips it on open
 * (measured) -- a limit of the editor, noted in the build plan, not something
 * this function can fix.
 */
function codeBlock(node: HtmlElement): string {
  const text = textContent(node).replace(/\n$/, '');
  const lines = text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`);
  return `<codeblock>${lines.join('')}</codeblock>`;
}

function tableRows(table: HtmlElement, ctx: Ctx): string[] {
  const rows: string[] = [];
  const walk = (nodes: HtmlNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      if (n.tag === 'tr') {
        const cells = n.children
          .filter((c): c is HtmlElement => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'))
          .map((c) => inline(c.children, ctx).replace(/<br>/g, ' ').trim());
        if (cells.some(Boolean)) rows.push(`<p>${cells.join(' | ')}</p>`);
      } else walk(n.children);
    }
  };
  walk(table.children);
  return rows;
}

// ─── Inline ───────────────────────────────────────────────────────────────

/** Inline nodes as editor-dialect HTML. `<br>` is kept for `paragraphs` to split on. */
function inline(nodes: HtmlNode[], ctx: Ctx): string {
  return nodes.map((node) => inlineNode(node, ctx)).join('');
}

function inlineNode(node: HtmlNode, ctx: Ctx): string {
  if (node.type === 'text') return escapeHtml(node.text.replace(/\s*\n\s*/g, ' '));
  const inner = () => inline(node.children, ctx);

  switch (node.tag) {
    case 'b':
    case 'strong':
      return tag('b', inner());
    case 'i':
    case 'em':
      return tag('i', inner());
    case 'u':
    case 'ins':
      return tag('u', inner());
    case 's':
    case 'del':
    case 'strike':
      return tag('s', inner());
    case 'code':
      return tag('code', escapeHtml(textContent(node)));
    case 'br':
      return '<br>';
    case 'a': {
      const href = safeHref(node.attrs.href);
      if (!href) {
        if (node.attrs.href) ctx.degraded.add('unsafe link');
        return inner();
      }
      return `<a href="${escapeAttr(href)}">${inner()}</a>`;
    }
    case 'img': {
      const src = safeImageSrc(node.attrs.src);
      if (!src) {
        if (node.attrs.src) ctx.degraded.add('image with an unsupported source');
        return escapeHtml(node.attrs.alt ?? '');
      }
      return `<img src="${escapeAttr(src)}"/>`;
    }
    case 'input':
      return '';
    default:
      // Anything not on the allowlist -- including <script>, whose text is
      // kept as text and so is inert -- loses its tag and keeps its content.
      return inner();
  }
}

function tag(name: string, inner: string): string {
  return inner ? `<${name}>${inner}</${name}>` : '';
}
