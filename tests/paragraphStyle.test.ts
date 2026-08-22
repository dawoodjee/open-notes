/**
 * The desktop `Aa` panel's paragraph-style logic.
 *
 * The assertion that earns its keep is EXACTLY ONE TICK: a menu with none
 * ticked looks broken on an ordinary line, and a menu with two is lying.
 */
import { describe, it, expect } from './harness';
import {
  BLOCK_STYLES,
  activeParagraphStyle,
  activeTextStyle,
  paragraphStyleToggles,
} from '../lib/notes/paragraphStyle';
import type { ToolKey } from '../lib/notes/toolbarContext';

describe('activeParagraphStyle', () => {
  it('BODY WHEN NOTHING IS ACTIVE — the ordinary line', () => {
    expect(activeParagraphStyle({})).toBe('body');
    // Inline marks are not paragraph styles and must not steal the tick.
    expect(activeParagraphStyle({ bold: true, italic: true })).toBe('body');
  });

  it('names whichever block style is on', () => {
    expect(activeParagraphStyle({ heading: true })).toBe('heading');
    expect(activeParagraphStyle({ bulletList: true })).toBe('bulletList');
  });

  it('exactly one style is ever reported, for every single-style state', () => {
    for (const key of BLOCK_STYLES) {
      const reported = activeParagraphStyle({ [key]: true } as Partial<Record<ToolKey, boolean>>);
      expect(reported).toBe(key);
    }
  });
});

describe('paragraphStyleToggles', () => {
  it('from Body to a style: turn that style on', () => {
    expect(paragraphStyleToggles({}, 'heading')).toEqual(['heading']);
  });

  it('from a style to Body: turn THAT style off, nothing else', () => {
    // The bug this prevents is toggling every block style in the list, which
    // would turn six of them ON in an editor whose toggles are their inverse.
    expect(paragraphStyleToggles({ heading: true }, 'body')).toEqual(['heading']);
  });

  it('already Body, asked for Body: do nothing', () => {
    expect(paragraphStyleToggles({}, 'body')).toEqual([]);
  });

  it('swapping styles clears the old one first', () => {
    // Order matters to the editor: turning h1 on while a list is active gives
    // a heading inside a list item, not a heading.
    expect(paragraphStyleToggles({ bulletList: true }, 'heading')).toEqual([
      'bulletList',
      'heading',
    ]);
  });

  it('re-selecting the active style turns it off, landing on Body', () => {
    expect(paragraphStyleToggles({ heading: true }, 'heading')).toEqual(['heading']);
    // ...and the result of that is Body, which closes the loop.
    expect(activeParagraphStyle({})).toBe('body');
  });
});

describe('activeTextStyle — the iPad pills', () => {
  it('A LIST DOES NOT BLANK THE PILL ROW', () => {
    // The bug this is here for: using activeParagraphStyle for the pills meant
    // that the moment a bullet was active, no pill was highlighted at all and
    // the row read as broken. A list has a text style like any other line.
    expect(activeTextStyle({ bulletList: true })).toBe('body');
    expect(activeParagraphStyle({ bulletList: true })).toBe('bulletList');
  });

  it('a heading inside a list is still a heading', () => {
    expect(activeTextStyle({ bulletList: true, heading2: true })).toBe('heading2');
  });

  it('plain text is Body', () => {
    expect(activeTextStyle({})).toBe('body');
    expect(activeTextStyle({ bold: true })).toBe('body');
  });
});
