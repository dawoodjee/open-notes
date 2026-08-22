/**
 * The keyboard bar's context-awareness.
 *
 * The assertions that matter are the INVARIANTS across contexts, not any one
 * ordering. The bar sits under a moving thumb and its context can change
 * mid-gesture -- typing `- ` turns a paragraph into a list item -- so "the set
 * never changes, only the order" is the property that keeps a button from
 * sliding out from under a finger already reaching for it.
 */
import { describe, it, expect } from './harness';
import {
  isSupported,
  toolbarOrder,
  UNSUPPORTED,
  type EditorContext,
  type ToolKey,
} from '../lib/notes/toolbarContext';

const PLAIN: EditorContext = { onListItem: false, onBlankBodyLine: false };
const LIST: EditorContext = { onListItem: true, onBlankBodyLine: false };
const BLANK: EditorContext = { onListItem: false, onBlankBodyLine: true };
const EMPTY_BULLET: EditorContext = { onListItem: true, onBlankBodyLine: true };

const ALL = [PLAIN, LIST, BLANK, EMPTY_BULLET];

const sorted = (keys: ToolKey[]) => [...keys].sort().join(',');

describe('toolbarOrder — what comes forward', () => {
  it('on a list item: indent, outdent, strikethrough lead', () => {
    expect(toolbarOrder(LIST).slice(0, 3)).toEqual(['indent', 'outdent', 'strikethrough']);
  });

  it('on a blank body line: heading and bullet lead', () => {
    expect(toolbarOrder(BLANK).slice(0, 2)).toEqual(['heading', 'bulletList']);
  });

  it('anywhere else: the plain inline set, bold first', () => {
    expect(toolbarOrder(PLAIN)[0]).toBe('bold');
  });

  it('AN EMPTY BULLET IS STILL A BULLET', () => {
    // Both contexts are true at once here, and list has to win: on an empty
    // bullet you want to nest it, not to turn its line into a heading.
    expect(toolbarOrder(EMPTY_BULLET).slice(0, 3)).toEqual(['indent', 'outdent', 'strikethrough']);
  });
});

describe('toolbarOrder — invariants across every context', () => {
  it('THE SET NEVER CHANGES, ONLY THE ORDER', () => {
    // The one that keeps a control from sliding out from under a thumb that is
    // already moving toward it.
    const reference = sorted(toolbarOrder(PLAIN));
    for (const ctx of ALL) {
      expect(sorted(toolbarOrder(ctx))).toBe(reference);
    }
  });

  it('never repeats a control', () => {
    for (const ctx of ALL) {
      const order = toolbarOrder(ctx);
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it('the promoted controls are REMOVED from their resting positions', () => {
    // Otherwise they would appear twice -- once at the front and once where
    // they normally live -- which the no-duplicates test would catch, but this
    // says why it matters.
    const order = toolbarOrder(LIST);
    expect(order.indexOf('strikethrough')).toBe(2);
    expect(order.lastIndexOf('strikethrough')).toBe(2);
  });

  it('unsupported controls are still present, never dropped', () => {
    // They render dimmed. Dropping them would make the bar's layout shift the
    // day the editor gains them, which is the whole reason for showing them.
    for (const ctx of ALL) {
      const order = toolbarOrder(ctx);
      for (const key of UNSUPPORTED) {
        expect(order.includes(key)).toBe(true);
      }
    }
  });

  it('the list context leads with two controls that do not work yet', () => {
    // Recorded deliberately rather than glossed: indent and outdent are
    // unsupported, so on a bullet the bar leads with two dimmed buttons and one
    // live one. If this test ever starts failing because they became
    // supported, that is the good outcome -- update it then.
    expect(isSupported('indent')).toBe(false);
    expect(isSupported('outdent')).toBe(false);
    expect(isSupported('strikethrough')).toBe(true);
  });
});
