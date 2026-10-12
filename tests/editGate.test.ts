import { describe, it, expect } from './harness';
import { INTERACTION_EVENTS, isEdit } from '../lib/notes/editGate';

describe('isEdit — did a person cause this change event?', () => {
  it('armed, nobody has acted: a rendition, not an edit', () => {
    // The mount-time event, and the one after a remote edit is applied.
    expect(isEdit({ armed: true, userActed: false })).toBe(false);
  });

  it('armed, the person acted: an edit', () => {
    expect(isEdit({ armed: true, userActed: true })).toBe(true);
  });

  it('NOT armed: always an edit, whatever the flag says', () => {
    // Native, or a web mount whose listeners never attached. The gate must
    // never withhold a save it cannot justify -- that would discard typing.
    expect(isEdit({ armed: false, userActed: false })).toBe(true);
    expect(isEdit({ armed: false, userActed: true })).toBe(true);
  });
});

describe('INTERACTION_EVENTS', () => {
  it('covers typing, the keys the editor handles itself, clipboard, drop, IME and clicks', () => {
    for (const name of ['keydown', 'beforeinput', 'paste', 'cut', 'drop', 'compositionstart', 'pointerdown']) {
      expect((INTERACTION_EVENTS as readonly string[]).includes(name)).toBe(true);
    }
  });
});
