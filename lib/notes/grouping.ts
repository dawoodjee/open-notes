import type { Note } from '@/types/note';

/**
 * Splitting a flat list of notes into the sections the list view renders.
 *
 * Pure and `now`-injectable on purpose: every interesting case here is a date
 * boundary, and a function that reads the clock itself can only be tested by
 * waiting until midnight.
 *
 * WHY BUCKETS AND NOT JUST A DATE ON EACH ROW. The row already shows a date.
 * The buckets exist because "when did I write this" is answered far better by
 * position than by reading timestamps -- you scroll to roughly-last-week
 * rather than scanning for it. That is also why the buckets get coarser as
 * they get older: last Tuesday is a thing people remember, the 14th of June
 * two years ago is not.
 */

export interface NoteSection {
  /** Stable across renders. Used as the SectionList key. */
  key: string;
  /** What the header reads. Empty string = an unlabelled section, which is
   *  what an ungrouped list is: one section with no header. */
  title: string;
  /** True for the pinned section, which is styled and ordered differently. */
  isPinned: boolean;
  data: Note[];
}

export const PINNED_SECTION_KEY = 'pinned';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Whole calendar days between two instants, ignoring the time of day. */
function calendarDaysAgo(date: Date, now: Date): number {
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

/**
 * Which bucket a note falls in.
 *
 * Exported so a test can assert the boundaries directly rather than inferring
 * them from an assembled section list.
 */
export function dateBucketFor(updatedAt: string, now: Date): { key: string; title: string } {
  const date = new Date(updatedAt);

  // An unparseable timestamp would otherwise produce a NaN-keyed section that
  // silently swallows rows. Give it a real bucket at the very bottom instead.
  if (Number.isNaN(date.getTime())) {
    return { key: 'undated', title: 'Undated' };
  }

  const days = calendarDaysAgo(date, now);

  if (days <= 0) return { key: 'today', title: 'Today' };
  if (days === 1) return { key: 'yesterday', title: 'Yesterday' };
  if (days < 7) return { key: 'prev7', title: 'Previous 7 Days' };
  if (days < 30) return { key: 'prev30', title: 'Previous 30 Days' };

  // Older than a month: by month within the current year, by year before that.
  // A month name alone would be ambiguous across years ("June" twice), which
  // is exactly why the year takes over rather than the two being combined.
  if (date.getFullYear() === now.getFullYear()) {
    return { key: `m-${date.getMonth()}`, title: MONTHS[date.getMonth()] };
  }
  return { key: `y-${date.getFullYear()}`, title: String(date.getFullYear()) };
}

function newest(notes: Note[]): number {
  return notes.reduce((max, n) => {
    const t = new Date(n.updatedAt).getTime();
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, -Infinity);
}

export interface BuildSectionsOptions {
  /** Honour the folder's Group By Date setting. False = one flat section. */
  groupByDate: boolean;
  /** Injected so the boundaries are testable. Defaults to the real clock. */
  now?: Date;
}

/**
 * Build the sections for a list of notes.
 *
 * Pinned always comes first when anything is pinned, ABOVE the first date
 * group and regardless of how recently the pinned notes were touched -- that
 * is the whole point of pinning. Everything else is ordered by its newest
 * note, which produces Today / Yesterday / Previous 7 Days / ... for free
 * without hardcoding the order of buckets that may not all exist.
 */
export function buildNoteSections(
  notes: Note[],
  { groupByDate, now = new Date() }: BuildSectionsOptions
): NoteSection[] {
  const byRecency = [...notes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const pinned = byRecency.filter((n) => n.isPinned);
  const rest = byRecency.filter((n) => !n.isPinned);

  const sections: NoteSection[] = [];

  if (pinned.length > 0) {
    sections.push({ key: PINNED_SECTION_KEY, title: 'Pinned', isPinned: true, data: pinned });
  }

  if (rest.length === 0) return sections;

  if (!groupByDate) {
    // One unlabelled section rather than zero sections: SectionList needs a
    // section to render rows at all, and an empty title is what suppresses
    // the header.
    sections.push({ key: 'all', title: '', isPinned: false, data: rest });
    return sections;
  }

  const buckets = new Map<string, NoteSection>();
  for (const note of rest) {
    const { key, title } = dateBucketFor(note.updatedAt, now);
    const existing = buckets.get(key);
    if (existing) {
      existing.data.push(note);
    } else {
      buckets.set(key, { key, title, isPinned: false, data: [note] });
    }
  }

  sections.push(...[...buckets.values()].sort((a, b) => newest(b.data) - newest(a.data)));
  return sections;
}
