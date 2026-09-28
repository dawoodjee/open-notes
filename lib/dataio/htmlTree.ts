/**
 * A small, forgiving HTML parser: string in, tree out.
 *
 * ── WHY HAND-ROLLED ───────────────────────────────────────────────────────
 *
 * React Native has no DOM, so `DOMParser` and every library built on it
 * (turndown included) is unavailable on a phone. The input here is also
 * unusually narrow: note bodies are whatever `react-native-enriched-html`
 * stores, a dozen tags with almost no attributes. A general HTML5 parser would
 * be most of a megabyte to handle a document shape this app never produces.
 *
 * ── WHY FORGIVING ─────────────────────────────────────────────────────────
 *
 * Export runs over every note a user owns, including bodies written by older
 * builds (TenTap's `<strong>`/`<pre>` dialect, before Stage 11.5) and whatever
 * import writes. One malformed body must degrade, never throw: a converter
 * that throws takes down a whole export for the sake of one note. So stray
 * close tags are ignored, unclosed tags are closed at the end, and a `<` that
 * does not start a tag is kept as text.
 *
 * Both directions use this tree -- export walks it into Markdown, and import
 * walks `marked`'s output back down into the editor's dialect -- so the two
 * can never disagree about what a tag means.
 */

export type HtmlNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: string; attrs: Record<string, string>; children: HtmlNode[] };

export type HtmlElement = Extract<HtmlNode, { type: 'element' }>;

/** Elements that never have children or a closing tag. */
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'wbr', 'col', 'source']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode the entities HTML text can carry. Unknown names are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // An out-of-range code point would make fromCodePoint throw -- the one
      // way an entity could take a whole export down.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Escape text for an HTML text node. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape text for a double-quoted attribute value. */
export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source))) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[m[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlElement = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1];

  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    const siblings = top().children;
    const last = siblings[siblings.length - 1];
    // Merge adjacent text so a `<` kept as text does not split a word in two.
    if (last && last.type === 'text') last.text += text;
    else siblings.push({ type: 'text', text });
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    pushText(html.slice(i, lt));

    // Comments and doctypes carry nothing a note needs.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/.exec(html.slice(lt));
    if (!tagMatch) {
      // A bare `<` in text -- "a < b" -- is text, not a broken tag.
      pushText('<');
      i = lt + 1;
      continue;
    }

    const [whole, slash, rawName, rest] = tagMatch;
    const tag = rawName.toLowerCase();
    i = lt + whole.length;

    if (slash) {
      // Close the nearest matching open element; a stray closer is ignored
      // rather than allowed to unwind the whole stack.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].tag === tag) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(rest);
    const element: HtmlElement = {
      type: 'element',
      tag,
      attrs: parseAttrs(rest.replace(/\/\s*$/, '')),
      children: [],
    };
    top().children.push(element);
    if (!selfClosing && !VOID.has(tag)) stack.push(element);
  }

  return root.children;
}

/** All the text under a node, entities already decoded. */
export function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.text;
  if (node.tag === 'br') return '\n';
  return node.children.map(textContent).join('');
}
