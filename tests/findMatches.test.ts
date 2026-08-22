/**
 * Find and replace inside one note.
 *
 * The assertion that matters most is that replace NEVER TOUCHES MARKUP. Getting
 * that wrong does not throw — it silently rewrites a stored note into something
 * that is no longer HTML, and the user finds out later.
 */
import { describe, it, expect } from './harness';
import { findMatches, replaceInHtml, stepMatch } from '../lib/notes/findMatches';

describe('findMatches', () => {
  it('finds every occurrence, left to right', () => {
    expect(findMatches('one two one', 'one')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('is case-insensitive by default and exact when asked', () => {
    expect(findMatches('Cat cat', 'cat').length).toBe(2);
    expect(findMatches('Cat cat', 'cat', { caseSensitive: true }).length).toBe(1);
  });

  it('MATCHES DO NOT OVERLAP', () => {
    // "aa" in "aaaa" is two matches. Overlapping would make "next" advance by
    // one character, which reads as a broken button rather than a feature.
    expect(findMatches('aaaa', 'aa').length).toBe(2);
  });

  it('an empty query finds nothing rather than everything', () => {
    // The state the bar is in before you type. Returning a match per character
    // would light the whole note up.
    expect(findMatches('anything', '')).toEqual([]);
  });
});

describe('stepMatch', () => {
  it('wraps at both ends', () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
  });

  it('from nothing selected, next goes first and previous goes last', () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
  });

  it('no matches means no current match', () => {
    expect(stepMatch(-1, 0, 1)).toBe(-1);
  });
});

describe('replaceInHtml — the one that can corrupt a note', () => {
  it('NEVER REWRITES MARKUP', () => {
    // Searching for "b" is the first single-letter search anybody types, and a
    // naive replaceAll turns every <b> tag into garbage.
    const html = '<html>\n<p>a <b>bold</b> word</p>\n</html>';
    const { html: out, count } = replaceInHtml(html, 'b', 'X', 'all');
    expect(out).toBe('<html>\n<p>a <b>Xold</b> word</p>\n</html>');
    expect(count).toBe(1);
  });

  it('replaces one occurrence by index, counting across text nodes', () => {
    const html = '<p>cat</p><p>cat</p><p>cat</p>';
    expect(replaceInHtml(html, 'cat', 'dog', 1).html).toBe('<p>cat</p><p>dog</p><p>cat</p>');
  });

  it('replaces all, and reports how many', () => {
    const html = '<p>cat cat</p><p>cat</p>';
    const result = replaceInHtml(html, 'cat', 'dog', 'all');
    expect(result.html).toBe('<p>dog dog</p><p>dog</p>');
    expect(result.count).toBe(3);
  });

  it('leaves the note alone when nothing matches', () => {
    const html = '<p>hello</p>';
    const result = replaceInHtml(html, 'zzz', 'x', 'all');
    expect(result.html).toBe(html);
    expect(result.count).toBe(0);
  });

  it('a match that straddles a tag boundary is not found, deliberately', () => {
    // "bold" is on screen but exists in no single text node. Replacing it would
    // mean deciding which half keeps the <b>, and there is no right answer.
    const html = '<p><b>bo</b>ld</p>';
    expect(replaceInHtml(html, 'bold', 'x', 'all').count).toBe(0);
  });

  it('an attribute value is markup, not text', () => {
    const html = '<p><a href="https://cat.example">cat</a></p>';
    const out = replaceInHtml(html, 'cat', 'dog', 'all');
    expect(out.html).toBe('<p><a href="https://cat.example">dog</a></p>');
    expect(out.count).toBe(1);
  });

  it('an unterminated tag is left whole rather than half-rewritten', () => {
    const html = '<p>cat</p><b class="cat';
    expect(replaceInHtml(html, 'cat', 'dog', 'all').html).toBe('<p>dog</p><b class="cat');
  });
});
