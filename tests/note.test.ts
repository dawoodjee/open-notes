/**
 * Pure helpers in `types/note.ts`.
 *
 * `isBlankNote` gets the most attention here because it is the only function in
 * the app whose wrong answer PERMANENTLY DELETES a note rather than trashing it
 * (see `leaveNote`/`discardIfEmpty`). It also has to keep working against
 * whatever the editor emits, so if the editor is ever replaced these are the
 * tests that have to go green first.
 */
import { describe, it, expect } from './harness';
import { isBlankNote, noteToPlainText, formatNoteDate, parseNoteContent } from '../types/note';

describe('isBlankNote', () => {
  it('empty string is blank', () => {
    expect(isBlankNote('')).toBe(true);
  });

  it('the heading TenTap seeds a new note with is blank', () => {
    expect(isBlankNote('<h1></h1>')).toBe(true);
  });

  it('a paragraph left behind by typing and deleting is blank', () => {
    expect(isBlankNote('<p></p>')).toBe(true);
  });

  it('several empty blocks together are still blank', () => {
    expect(isBlankNote('<h1></h1><p></p><p></p>')).toBe(true);
  });

  it('whitespace only is blank', () => {
    expect(isBlankNote('<p>   </p>')).toBe(true);
  });

  it('a non-breaking space is blank -- it is what an "empty" line often holds', () => {
    expect(isBlankNote('<p>&nbsp;</p>')).toBe(true);
  });

  it('a single character is NOT blank', () => {
    // The note that must never be silently destroyed.
    expect(isBlankNote('<h1>r</h1>')).toBe(false);
  });

  it('a title with no body is NOT blank', () => {
    expect(isBlankNote('<h1>Groceries</h1><p></p>')).toBe(false);
  });

  it('body with no title is NOT blank', () => {
    expect(isBlankNote('<h1></h1><p>milk</p>')).toBe(false);
  });
});

describe('noteToPlainText', () => {
  it('strips tags', () => {
    expect(noteToPlainText('<h1>Title</h1><p>Body</p>')).toBe('Title\n\nBody');
  });

  it('decodes entities, because this text leaves the app', () => {
    // "Eggs &amp; bread" arriving literally in someone's Messages thread is
    // the app's mistake, not theirs.
    expect(noteToPlainText('<p>Eggs &amp; bread</p>')).toBe('Eggs & bread');
  });

  it('decodes numeric entities', () => {
    expect(noteToPlainText('<p>caf&#233;</p>')).toBe('café');
  });

  it('leaves an unknown entity exactly as written', () => {
    // A stray "&foo;" is someone's literal typing far more often than markup.
    expect(noteToPlainText('<p>a &foo; b</p>')).toContain('&foo;');
  });

  it('separates blocks with a blank line so paragraphs survive elsewhere', () => {
    expect(noteToPlainText('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
  });

  it('drops empty blocks rather than emitting stray blank lines', () => {
    expect(noteToPlainText('<h1>T</h1><p></p><p>B</p>')).toBe('T\n\nB');
  });

  it('an empty note produces an empty string', () => {
    expect(noteToPlainText('<h1></h1>')).toBe('');
  });
});

describe('parseNoteContent', () => {
  it('takes the title from the first line', () => {
    expect(parseNoteContent('<h1>Meeting notes</h1><p>Body</p>').title).toBe('Meeting notes');
  });

  it('an empty note gets the "New Note" placeholder, not an empty title', () => {
    // A blank row in the list would read as a rendering bug; the placeholder
    // is deliberate.
    expect(parseNoteContent('<h1></h1>').title).toBe('New Note');
  });
});

describe('formatNoteDate', () => {
  // formatNoteDate works in LOCAL calendar days, so fixtures are built by
  // stepping back from a local midday rather than written as UTC instants --
  // a UTC literal near midnight lands on a different local day and would make
  // these pass or fail depending on the machine's timezone.
  const now = new Date(2026, 7, 19, 15, 0, 0); // 19 Aug 2026, 15:00 local
  const daysBefore = (n: number) =>
    new Date(2026, 7, 19 - n, 9, 30, 0);

  it('today shows a time, not a date', () => {
    const out = formatNoteDate(daysBefore(0), now);
    expect(out).toBe('09:30');
  });

  it('yesterday is named', () => {
    expect(formatNoteDate(daysBefore(1), now)).toBe('Yesterday');
  });

  it('two to six days ago is a weekday name', () => {
    // Added in Stage 11; desktop-date-group-separator.png shows it and the
    // original implementation did not have it.
    const out = formatNoteDate(daysBefore(2), now);
    expect(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(out)
    ).toBe(true);
  });

  it('six days ago is still a weekday name', () => {
    const out = formatNoteDate(daysBefore(6), now);
    expect(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(out)
    ).toBe(true);
  });

  it('seven days ago is a date, not a weekday', () => {
    const out = formatNoteDate(daysBefore(7), now);
    expect(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(out)
    ).toBe(false);
  });
});
