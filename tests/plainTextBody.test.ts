/**
 * The web editor's plain-text projection.
 *
 * The assertion that earns its keep is the REFUSAL: a formatted note must not
 * be editable as plain text, because an autosave over the projection would
 * flatten it without anyone touching a key.
 */
import { describe, it, expect } from './harness';
import { isPlainTextSafe, toPlainText, toPlainTextHtml } from '../lib/notes/plainTextBody';
import { toEnrichedHtml } from '../lib/notes/htmlMigrate';
import { isBlankNote } from '../types/note';

describe('isPlainTextSafe — what web is allowed to edit', () => {
  it('an empty note is safe, which is the case that matters most', () => {
    // It is what every new note starts as, and creating notes is the whole
    // point of unblocking web.
    expect(isPlainTextSafe('')).toBe(true);
    expect(isPlainTextSafe(toEnrichedHtml(''))).toBe(true);
  });

  it('a heading and paragraphs are safe', () => {
    expect(isPlainTextSafe('<html>\n<h1>Title</h1>\n<p>Body</p>\n</html>')).toBe(true);
  });

  it('REFUSES anything it would flatten', () => {
    for (const body of [
      '<html>\n<h1>T</h1>\n<p>a <b>bold</b> word</p>\n</html>',
      '<html>\n<ul><li>one</li></ul>\n</html>',
      '<html>\n<blockquote>quoted</blockquote>\n</html>',
      '<html>\n<h2>subhead</h2>\n</html>',
      '<html>\n<p><a href="https://x">link</a></p>\n</html>',
    ]) {
      expect(isPlainTextSafe(body)).toBe(false);
    }
  });
});

describe('the round trip', () => {
  it('text survives a full round trip unchanged', () => {
    const text = 'Shopping\nMilk\nBread';
    expect(toPlainText(toPlainTextHtml(text))).toBe(text);
  });

  it('what it writes is something it will edit again', () => {
    // Otherwise a note would be editable on web once and read-only forever
    // after, which nobody would report as a bug in this function.
    expect(isPlainTextSafe(toPlainTextHtml('One\nTwo'))).toBe(true);
  });

  it('the first line becomes the heading', () => {
    expect(toPlainTextHtml('Title\nBody')).toBe('<html>\n<h1>Title</h1>\n<p>Body</p>\n</html>');
  });

  it('MARKUP IN THE TEXT IS ESCAPED, not stored as markup', () => {
    // A note is the string in this app most likely to contain pasted markup.
    const html = toPlainTextHtml('<script>alert(1)</script>');
    expect(html.includes('<script>')).toBe(false);
    expect(toPlainText(html)).toBe('<script>alert(1)</script>');
  });

  it('empty text stores as the empty body, so the note still reads as blank', () => {
    // isBlankNote decides whether a note is PERMANENTLY DELETED. A web note
    // opened and abandoned has to be as disposable as a native one.
    expect(toPlainTextHtml('   ')).toBe('');
    expect(isBlankNote('')).toBe(true);
  });
});

describe('toPlainText on bodies it did not write', () => {
  it('reads a formatted note legibly, since read-only still has to render', () => {
    expect(toPlainText('<html>\n<h1>T</h1>\n<p>a <b>bold</b> word</p>\n</html>')).toBe(
      'T\na bold word'
    );
  });

  it('decodes &amp; last, so &amp;lt; does not become <', () => {
    expect(toPlainText('<p>&amp;lt;</p>')).toBe('&lt;');
  });
});
