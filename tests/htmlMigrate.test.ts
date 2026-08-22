/**
 * Migration of stored TenTap HTML into the enriched dialect.
 *
 * Every expectation here was MEASURED on device first (see
 * docs/editor-migration-findings.md) rather than assumed -- the two rules being
 * encoded are a length-based plain-text heuristic and a silent drop of
 * <strong>/<em>, neither of which is documented upstream.
 */
import { describe, it, expect } from './harness';
import { toEnrichedHtml, isEnrichedHtml, stripEnrichedWrapper } from '../lib/notes/htmlMigrate';

describe('toEnrichedHtml', () => {
  it('wraps a legacy body', () => {
    expect(toEnrichedHtml('<h1>Note</h1>')).toBe('<html>\n<h1>Note</h1>\n</html>');
  });

  it('wraps a SHORT body -- the case that displayed as literal text', () => {
    // <h1>r</h1> is 10 chars and was escaped into visible markup. Wrapped it
    // is 24 and parses.
    expect(toEnrichedHtml('<h1>r</h1>')).toBe('<html>\n<h1>r</h1>\n</html>');
  });

  it('turns an empty note into an empty paragraph', () => {
    expect(toEnrichedHtml('')).toBe('<html>\n<p></p>\n</html>');
    expect(toEnrichedHtml('   ')).toBe('<html>\n<p></p>\n</html>');
  });

  it('converts strong and em, which the library silently drops', () => {
    expect(toEnrichedHtml('<p><strong>b</strong> and <em>i</em></p>')).toBe(
      '<html>\n<p><b>b</b> and <i>i</i></p>\n</html>'
    );
  });

  it('puts each block on its own line', () => {
    // TenTap writes blocks with no separator, and two blocks on one line cost
    // the second its inline formatting.
    expect(toEnrichedHtml('<h1>T</h1><p>body</p>')).toBe('<html>\n<h1>T</h1>\n<p>body</p>\n</html>');
  });

  it('splits blocks AND converts inline tags together', () => {
    expect(toEnrichedHtml('<h1>T</h1><p><strong>b</strong></p>')).toBe(
      '<html>\n<h1>T</h1>\n<p><b>b</b></p>\n</html>'
    );
  });

  it('separates list items', () => {
    expect(toEnrichedHtml('<ul><li>a</li><li>b</li></ul>')).toBe(
      '<html>\n<ul><li>a</li>\n<li>b</li>\n</ul>\n</html>'
    );
  });

  it('leaves tags the library understands alone', () => {
    expect(toEnrichedHtml('<p><u>u</u> <s>s</s> <code>c</code></p>')).toBe(
      '<html>\n<p><u>u</u> <s>s</s> <code>c</code></p>\n</html>'
    );
  });

  it('preserves links and their href', () => {
    expect(toEnrichedHtml('<p><a href="https://e.com">e</a></p>')).toContain('href="https://e.com"');
  });

  it('IS IDEMPOTENT -- this runs on every note open', () => {
    // Without this the document would gain a wrapper every time it was read.
    const once = toEnrichedHtml('<h1>T</h1><p>body</p>');
    expect(toEnrichedHtml(once)).toBe(once);
    expect(toEnrichedHtml(toEnrichedHtml(once))).toBe(once);
  });

  it('leaves an already-migrated body byte-identical', () => {
    const already = '<html>\n<h1>Note</h1>\n<p>Body</p>\n</html>';
    expect(toEnrichedHtml(already)).toBe(already);
  });

  it('does not rewrite text that merely mentions the tag names', () => {
    // The conversion matches bare tags only, so prose about markup survives.
    const body = '<p>the strong and em elements</p>';
    expect(toEnrichedHtml(body)).toContain('the strong and em elements');
  });
});

describe('isEnrichedHtml', () => {
  it('recognises the new dialect', () => {
    expect(isEnrichedHtml('<html>\n<p>a</p>\n</html>')).toBe(true);
  });
  it('rejects legacy bodies', () => {
    expect(isEnrichedHtml('<h1>T</h1>')).toBe(false);
    expect(isEnrichedHtml('')).toBe(false);
  });
  it('tolerates leading whitespace', () => {
    expect(isEnrichedHtml('  <html>\n<p>a</p>\n</html>')).toBe(true);
  });
});

describe('stripEnrichedWrapper', () => {
  it('removes the wrapper', () => {
    expect(stripEnrichedWrapper('<html>\n<p>a</p>\n</html>')).toBe('<p>a</p>');
  });
  it('leaves a legacy body alone', () => {
    expect(stripEnrichedWrapper('<h1>T</h1>')).toBe('<h1>T</h1>');
  });
  it('round-trips with toEnrichedHtml for already-clean input', () => {
    expect(stripEnrichedWrapper(toEnrichedHtml('<p>a</p>'))).toBe('<p>a</p>');
  });
});
