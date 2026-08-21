/**
 * Date bucketing and section building.
 *
 * Every interesting case here is a BOUNDARY -- the difference between "Today"
 * and "Yesterday" is not a duration, it is a calendar edge. So the tests pin
 * `now` to a fixed instant and walk across each edge from both sides. Two of
 * these -- the 6/7-day edge, and a pinned note from last year outranking
 * today -- are cases a casual read of the implementation gets wrong.
 */
import { describe, it, expect } from './harness';
import { dateBucketFor, buildNoteSections, PINNED_SECTION_KEY } from '../lib/notes/grouping';
import type { Note } from '../types/note';

// Mid-afternoon, deliberately not near midnight, so that a test crossing a
// boundary crosses it because of the date arithmetic and not because the
// fixture happened to sit on an edge.
//
// Built from local components, not a UTC literal. dateBucketFor compares
// LOCAL calendar days, so a UTC instant near midnight lands on a different day
// depending on the machine's timezone and would make these tests pass or fail
// by geography. Every fixture below is built the same way.
const NOW = new Date(2026, 7, 19, 15, 0, 0);
const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m, d, h, 0, 0).toISOString();

function noteAt(updatedAt: string, extra: Partial<Note> = {}): Note {
  return {
    id: updatedAt + JSON.stringify(extra),
    userId: null,
    body: '<h1>t</h1>',
    title: 't',
    createdAt: updatedAt,
    updatedAt,
    isTrashed: false,
    trashedAt: null,
    folderId: null,
    isHiddenFromApi: false,
    isPinned: false,
    ...extra,
  } as Note;
}

describe('dateBucketFor', () => {
  it('same day is Today', () => {
    expect(dateBucketFor(at(2026, 7, 19, 9), NOW).key).toBe('today');
  });

  it('later the same day is still Today, not the future', () => {
    expect(dateBucketFor(at(2026, 7, 19, 23), NOW).key).toBe('today');
  });

  it('a timestamp in the future is Today rather than its own bucket', () => {
    // Clock skew between devices is real and a "tomorrow" section would be
    // nonsense, so days <= 0 collapses into Today.
    expect(dateBucketFor(at(2026, 7, 20, 9), NOW).key).toBe('today');
  });

  it('one calendar day back is Yesterday', () => {
    expect(dateBucketFor(at(2026, 7, 18, 23), NOW).key).toBe('yesterday');
  });

  it('two days back is Previous 7 Days, not Yesterday', () => {
    expect(dateBucketFor(at(2026, 7, 17, 15), NOW).key).toBe('prev7');
  });

  it('six days back is the last day of Previous 7 Days', () => {
    expect(dateBucketFor(at(2026, 7, 13, 15), NOW).key).toBe('prev7');
  });

  it('seven days back crosses into Previous 30 Days', () => {
    expect(dateBucketFor(at(2026, 7, 12, 15), NOW).key).toBe('prev30');
  });

  it('twenty-nine days back is still Previous 30 Days', () => {
    expect(dateBucketFor(at(2026, 6, 21, 15), NOW).key).toBe('prev30');
  });

  it('thirty days back falls through to the month bucket', () => {
    const bucket = dateBucketFor(at(2026, 6, 20, 15), NOW);
    expect(bucket.key).toBe('m-6');
    expect(bucket.title).toBe('July');
  });

  it('an earlier month this year is named by month', () => {
    expect(dateBucketFor(at(2026, 1, 3, 15), NOW).title).toBe('February');
  });

  it('last year is named by year, not by month', () => {
    // The month name alone would read as ambiguous -- two "June" headers in
    // one list, years apart.
    const bucket = dateBucketFor(at(2025, 5, 3, 15), NOW);
    expect(bucket.key).toBe('y-2025');
    expect(bucket.title).toBe('2025');
  });

  it('an unparseable timestamp gets a real bucket instead of NaN', () => {
    // A NaN key would silently swallow rows into a section that never renders.
    const bucket = dateBucketFor('not a date', NOW);
    expect(bucket.key).toBe('undated');
    expect(bucket.title).toBe('Undated');
  });

  it('an empty timestamp is undated rather than 1970', () => {
    expect(dateBucketFor('', NOW).key).toBe('undated');
  });
});

describe('buildNoteSections', () => {
  it('returns nothing for no notes', () => {
    expect(buildNoteSections([], { groupByDate: true, now: NOW }).length).toBe(0);
  });

  it('puts Pinned first', () => {
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 10)), noteAt(at(2026, 7, 19, 11), { isPinned: true })],
      { groupByDate: true, now: NOW }
    );
    expect(sections[0].key).toBe(PINNED_SECTION_KEY);
    expect(sections[0].isPinned).toBe(true);
  });

  it('keeps a pinned note from LAST YEAR above todays notes', () => {
    // The case that makes pinning worth having, and the one an
    // order-by-recency implementation gets wrong.
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 10)), noteAt(at(2025, 0, 2, 10), { isPinned: true })],
      { groupByDate: true, now: NOW }
    );
    expect(sections[0].key).toBe(PINNED_SECTION_KEY);
    expect(sections[1].key).toBe('today');
  });

  it('does not also list a pinned note in its date bucket', () => {
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 10), { isPinned: true })],
      { groupByDate: true, now: NOW }
    );
    expect(sections.length).toBe(1);
    expect(sections[0].key).toBe(PINNED_SECTION_KEY);
  });

  it('orders date sections newest-first', () => {
    const sections = buildNoteSections(
      [
        noteAt(at(2025, 5, 1, 10)),
        noteAt(at(2026, 7, 19, 10)),
        noteAt(at(2026, 7, 18, 10)),
        noteAt(at(2026, 7, 1, 10)),
      ],
      { groupByDate: true, now: NOW }
    );
    expect(sections.map((s) => s.key)).toEqual(['today', 'yesterday', 'prev30', 'y-2025']);
  });

  it('groupByDate false gives ONE unlabelled section', () => {
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 10)), noteAt(at(2025, 5, 1, 10))],
      { groupByDate: false, now: NOW }
    );
    expect(sections.length).toBe(1);
    // Empty title is what suppresses the header -- not a missing title.
    expect(sections[0].title).toBe('');
    expect(sections[0].data.length).toBe(2);
  });

  it('groupByDate false still keeps Pinned separate', () => {
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 10)), noteAt(at(2026, 7, 18, 10), { isPinned: true })],
      { groupByDate: false, now: NOW }
    );
    expect(sections.map((s) => s.key)).toEqual([PINNED_SECTION_KEY, 'all']);
  });

  it('sorts notes within a section newest-first', () => {
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 9)), noteAt(at(2026, 7, 19, 14))],
      { groupByDate: true, now: NOW }
    );
    expect(sections[0].data[0].updatedAt).toBe(at(2026, 7, 19, 14));
  });

  it('undated notes do not vanish', () => {
    const sections = buildNoteSections(
      [noteAt(at(2026, 7, 19, 10)), noteAt('nonsense')],
      { groupByDate: true, now: NOW }
    );
    const keys = sections.map((s) => s.key);
    expect(keys.includes('undated')).toBe(true);
    const total = sections.reduce((n, s) => n + s.data.length, 0);
    expect(total).toBe(2);
  });

  it('never loses a note across many buckets', () => {
    const notes = [
      noteAt(at(2026, 7, 19, 10)),
      noteAt(at(2026, 7, 18, 10)),
      noteAt(at(2026, 7, 15, 10)),
      noteAt(at(2026, 7, 1, 10)),
      noteAt(at(2026, 2, 1, 10)),
      noteAt(at(2025, 2, 1, 10)),
      noteAt(at(2024, 2, 1, 10)),
      noteAt(at(2026, 7, 19, 11), { isPinned: true }),
    ];
    const sections = buildNoteSections(notes, { groupByDate: true, now: NOW });
    const total = sections.reduce((n, s) => n + s.data.length, 0);
    expect(total).toBe(notes.length);
  });
});
