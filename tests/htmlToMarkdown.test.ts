import { describe, it, expect } from './harness';
import { htmlToMarkdown, escapeLineStart } from '../lib/dataio/htmlToMarkdown';

/**
 * Every input below is a body the editor was MEASURED producing, through its own
 * API, on 2026-09-28 -- see the Stage 15 checklist in the build plan. The
 * tests pin the converter to what is really stored, not to idealised HTML.
 */
const md = (body: string) => htmlToMarkdown(body).markdown;

describe('htmlToMarkdown — every construct the editor stores', () => {
  it('headings', () => {
    expect(md('<html><h1>a</h1><h3>c</h3><h6>f</h6></html>')).toBe('# a\n\n### c\n\n###### f\n');
  });

  it('bold, italic, strikethrough, inline code', () => {
    expect(md('<html><p><b>b</b> <i>i</i> <s>s</s> <code>c</code></p></html>')).toBe(
      '**b** *i* ~~s~~ `c`\n'
    );
  });

  it('underline as inline <u>, which Markdown has no syntax for', () => {
    expect(md('<html><p><u>sample text</u></p></html>')).toBe('<u>sample text</u>\n');
  });

  it('nested marks', () => {
    expect(md('<html><p><b><i>both</i></b></p></html>')).toBe('***both***\n');
  });

  it('links and images', () => {
    expect(md('<html><p><a href="https://example.com">sample text</a></p></html>')).toBe(
      '[sample text](https://example.com)\n'
    );
    expect(md('<html><p><img src="https://example.com/x.png" width="100" height="50"/></p></html>')).toBe(
      '![](https://example.com/x.png)\n'
    );
  });

  it('bullet and numbered lists', () => {
    expect(md('<html><ul><li>one</li><li>two</li></ul></html>')).toBe('- one\n- two\n');
    expect(md('<html><ol><li>one</li><li>two</li></ol></html>')).toBe('1. one\n2. two\n');
  });

  it('checklists — the non-standard <ul data-type="checkbox"> and <li checked>', () => {
    expect(md('<html><ul data-type="checkbox"><li checked>done</li><li>todo</li></ul></html>')).toBe(
      '- [x] done\n- [ ] todo\n'
    );
  });

  it('blockquotes', () => {
    expect(md('<html><blockquote><p>sample text</p></blockquote></html>')).toBe('> sample text\n');
  });

  it('code blocks — the non-standard <codeblock>, one <p> per line', () => {
    expect(md('<html><codeblock><p>line one</p><p>line two</p></codeblock></html>')).toBe(
      '```\nline one\nline two\n```\n'
    );
  });

  it('the seed of every new note is an empty heading, which exports as nothing', () => {
    expect(md('<html>\n<h1></h1>\n</html>')).toBe('');
  });

  it('native bodies carry newlines between blocks; they are not content', () => {
    expect(md('<html>\n<h1>Title</h1>\n<p>body</p>\n</html>')).toBe('# Title\n\nbody\n');
  });

  it('top-level <br> is the editor\'s empty line and collapses', () => {
    expect(md('<html><p>one</p><br><p>two</p><br></html>')).toBe('one\n\ntwo\n');
  });
});

describe('htmlToMarkdown — escaping, the part that silently loses data', () => {
  it('punctuation typed as text survives instead of becoming formatting', () => {
    // Measured: the editor stores these literally.
    expect(md('<html><p>a &amp; b &lt;tag&gt; *star* _u_</p></html>')).toBe(
      'a & b \\<tag> \\*star\\* \\_u\\_\n'
    );
  });

  it('intraword underscores are left alone — never emphasis in CommonMark', () => {
    expect(md('<html><p>snake_case_name</p></html>')).toBe('snake_case_name\n');
  });

  it('an entity typed as text does not turn into its character', () => {
    expect(md('<html><p>&amp;copy;</p></html>')).toBe('\\&copy;\n');
  });

  it('a line that looks like a heading, list or quote stays a line', () => {
    expect(md('<html><p>#hashtag</p></html>')).toBe('#hashtag\n'); // no space: not a heading
    expect(md('<html><p># not a heading</p></html>')).toBe('\\# not a heading\n');
    expect(md('<html><p>- not a bullet</p></html>')).toBe('\\- not a bullet\n');
    expect(md('<html><p>1. not a list</p></html>')).toBe('1\\. not a list\n');
    expect(md('<html><p>&gt; not a quote</p></html>')).toBe('\\> not a quote\n');
  });

  it('a line of dashes is not a horizontal rule', () => {
    expect(escapeLineStart('---')).toBe('\\---');
    expect(escapeLineStart('- - -')).toBe('\\- - -');
  });

  it('whitespace inside emphasis moves outside it, or the markers stop working', () => {
    expect(md('<html><p><b>bold </b>text</p></html>')).toBe('**bold** text\n');
  });

  it('a code span containing backticks gets a longer fence', () => {
    expect(md('<html><p><code>a`b</code></p></html>')).toBe('``a`b``\n');
  });

  it('a code block containing ``` gets a longer fence', () => {
    expect(md('<html><codeblock><p>```</p></codeblock></html>')).toBe('````\n```\n````\n');
  });

  it('code is not escaped — that is the point of a fence', () => {
    expect(md('<html><codeblock><p>a * b _c_</p></codeblock></html>')).toBe('```\na * b _c_\n```\n');
  });

  it('a link target with spaces or parens is angle-bracketed', () => {
    expect(md('<html><p><a href="https://e.com/a (b)">x</a></p></html>')).toBe('[x](<https://e.com/a (b)>)\n');
  });
});

describe('htmlToMarkdown — legacy and malformed bodies degrade, never throw', () => {
  it('pre-11.5 TenTap tags', () => {
    expect(md('<p><strong>s</strong> <em>e</em></p><pre><code>x = 1</code></pre>')).toBe(
      '**s** *e*\n\n```\nx = 1\n```\n'
    );
  });

  it('nested lists are written nested, not flattened', () => {
    expect(md('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe('- a\n  - b\n');
  });

  it('an unknown tag keeps its text and is reported', () => {
    const result = htmlToMarkdown('<html><p><mark>kept</mark></p></html>');
    expect(result.markdown).toBe('kept\n');
    expect(result.unmappedTags).toEqual(['mark']);
  });

  it('unclosed tags, stray closers and a bare < do not throw', () => {
    expect(md('<p><b>open</p></i>a < b')).toBe('**open**\n\na \\< b\n');
  });

  it('an out-of-range numeric entity is kept, not thrown on', () => {
    expect(md('<p>&#99999999;</p>')).toBe('\\&#99999999;\n');
  });
});
