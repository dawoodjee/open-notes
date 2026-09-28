import { describe, it, expect } from './harness';
import { markdownToHtml, safeHref } from '../lib/dataio/markdownToHtml';
import { htmlToMarkdown } from '../lib/dataio/htmlToMarkdown';

/** Bodies differ only in the newlines between blocks; compare without them. */
const flat = (html: string) => html.replace(/\n/g, '');
const html = (markdown: string) => flat(markdownToHtml(markdown).html);

describe('markdownToHtml — into the editor\'s own dialect', () => {
  it('bold and italic become <b> and <i>, which native needs', () => {
    // lib/notes/htmlMigrate.ts: native silently drops <strong>/<em> once wrapped.
    expect(html('**b** *i*')).toBe('<html><p><b>b</b> <i>i</i></p></html>');
  });

  it('task lists become the editor\'s checklist', () => {
    expect(html('- [x] done\n- [ ] todo')).toBe(
      '<html><ul data-type="checkbox"><li checked>done</li><li>todo</li></ul></html>'
    );
  });

  it('fenced code becomes <codeblock>, one <p> per line', () => {
    expect(html('```\nline one\nline two\n```')).toBe(
      '<html><codeblock><p>line one</p><p>line two</p></codeblock></html>'
    );
  });

  it('a hard line break splits the paragraph, as the editor itself does', () => {
    expect(html('one\\\ntwo')).toBe('<html><p>one</p><p>two</p></html>');
  });

  it('loose lists lose their <p> wrappers', () => {
    expect(html('- a\n\n- b')).toBe('<html><ul><li>a</li><li>b</li></ul></html>');
  });

  it('empty Markdown is an empty body, not an empty paragraph', () => {
    expect(markdownToHtml('').html).toBe('');
    expect(markdownToHtml('   \n\n').html).toBe('');
  });
});

describe('markdownToHtml — degrades rather than drops, and says so', () => {
  it('nested lists flatten into the parent', () => {
    const r = markdownToHtml('- a\n  - b');
    expect(flat(r.html)).toBe('<html><ul><li>a</li><li>b</li></ul></html>');
    expect(r.degraded).toEqual(['nested list']);
  });

  it('tables become a paragraph per row', () => {
    const r = markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(flat(r.html)).toBe('<html><p>a | b</p><p>1 | 2</p></html>');
    expect(r.degraded).toEqual(['table']);
  });

  it('a list inside a quote becomes quoted paragraphs', () => {
    const r = markdownToHtml('> - one\n> - two');
    expect(flat(r.html)).toBe('<html><blockquote><p>one</p><p>two</p></blockquote></html>');
    expect(r.degraded).toEqual(['formatting inside a quote']);
  });
});

describe('markdownToHtml — the security boundary', () => {
  it('a javascript: link loses its href and keeps its text', () => {
    // Measured: marked emits this as a live javascript: link.
    const r = markdownToHtml('[click](javascript:alert(1))');
    expect(flat(r.html)).toBe('<html><p>click</p></html>');
    expect(r.degraded).toEqual(['unsafe link']);
  });

  it('whitespace and control characters cannot smuggle a scheme past the check', () => {
    expect(safeHref('java\tscript:alert(1)')).toBe(null);
    expect(safeHref(' JAVASCRIPT:alert(1)')).toBe(null);
    expect(safeHref('data:text/html,x')).toBe(null);
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('notes/other.md')).toBe('notes/other.md');
  });

  it('raw HTML event handlers do not survive', () => {
    // Measured: marked passes <img onerror> through verbatim.
    const out = html('<img src="https://e.com/x.png" onerror="alert(1)">');
    expect(out).toBe('<html><p><img src="https://e.com/x.png"/></p></html>');
  });

  it('a script tag is reduced to inert text', () => {
    expect(html('<script>alert(1)</script>')).toBe('<html><p>alert(1)</p></html>');
  });

  it('a data: image is dropped to its alt text', () => {
    const r = markdownToHtml('![a picture](data:image/png;base64,AAAA)');
    expect(flat(r.html)).toBe('<html><p>a picture</p></html>');
  });
});

describe('ROUND TRIP — every stored construct, out to Markdown and back', () => {
  // The bodies the editor was measured storing (Stage 15 checklist). Each must
  // survive export then import unchanged -- the whole promise of the feature.
  const stored = [
    '<html><h1>Title</h1><p>body</p></html>',
    '<html><h2>sub</h2><h6>tiny</h6></html>',
    '<html><p><b>b</b> <i>i</i> <u>u</u> <s>s</s> <code>c</code></p></html>',
    '<html><p><a href="https://example.com">sample text</a></p></html>',
    '<html><ul><li>one</li><li>two</li></ul></html>',
    '<html><ol><li>one</li><li>two</li></ol></html>',
    '<html><ul data-type="checkbox"><li checked>done</li><li>todo</li></ul></html>',
    '<html><blockquote><p>a quote</p></blockquote></html>',
    '<html><codeblock><p>line one</p><p>line two</p></codeblock></html>',
    '<html><p><img src="https://example.com/x.png"/></p></html>',
  ];

  for (const body of stored) {
    it(body.replace(/<\/?html>/g, ''), () => {
      const back = markdownToHtml(htmlToMarkdown(body).markdown).html;
      expect(flat(back)).toBe(body);
    });
  }

  it('bold-inside-italic comes back italic-inside-bold — same rendering, same Markdown', () => {
    // `***both***` is the only Markdown for "bold and italic", and it parses as
    // <em><strong>. Nothing is lost -- it renders identically -- but a string
    // comparison would call the two bodies different. That is why collision
    // detection compares Markdown, not HTML (see lib/dataio/collisions.ts).
    const body = '<html><p><b><i>both</i></b></p></html>';
    const back = markdownToHtml(htmlToMarkdown(body).markdown).html;
    expect(flat(back)).toBe('<html><p><i><b>both</b></i></p></html>');
    expect(htmlToMarkdown(back).markdown).toBe(htmlToMarkdown(body).markdown);
  });

  it('punctuation typed as text survives the round trip as text', () => {
    // The escaping case: without it, these come back as formatting.
    const body = '<html><p>*star* _u_ # not heading 1. not list &amp;copy; a &lt; b</p></html>';
    expect(flat(markdownToHtml(htmlToMarkdown(body).markdown).html)).toBe(body);
  });

  it('lines that look like structure survive as lines', () => {
    const body = '<html><p># hash</p><p>- dash</p><p>1. one</p><p>&gt; quote</p><p>---</p></html>';
    expect(flat(markdownToHtml(htmlToMarkdown(body).markdown).html)).toBe(body);
  });
});
