/**
 * Is this change event an EDIT, or just the editor showing what it was given?
 *
 * WHY THE QUESTION EXISTS. The editor's web build fires a change event the
 * moment it mounts, carrying the note as IT serialises it -- and again when
 * content is set programmatically. A note last written on a phone, or imported,
 * serialises differently, so treating every change as typing rewrote each note
 * merely by opening it: "last edited" moved, and on a synced account the
 * rewrite uploaded to every other device. Nobody had touched anything.
 *
 * THE RULE. A change is an edit only once a person has done something -- a key,
 * an input event, a paste, a click in the editor, a toolbar button. Everything
 * before that is a rendition.
 *
 * FAIL-SAFE DIRECTION, and the reason this is a tested function rather than an
 * inline `&&`: the gate may only ever withhold a save when it is ARMED, meaning
 * the platform can observe interaction and the listeners are really attached.
 * Unarmed -- native, or a web mount where the element was not there -- every
 * change is an edit, exactly as before. Getting this backwards would not bump a
 * timestamp; it would silently discard what someone typed.
 */
export function isEdit({ armed, userActed }: { armed: boolean; userActed: boolean }): boolean {
  if (!armed) return true;
  return userActed;
}

/**
 * The DOM events that mean a person acted inside the editor. `beforeinput`
 * covers typing, dictation, spellcheck and IME; `keydown` covers the keys the
 * editor handles itself (Enter, Backspace, shortcuts) without an input event;
 * `pointerdown` covers ticking a checklist box.
 */
export const INTERACTION_EVENTS = [
  'keydown',
  'beforeinput',
  'paste',
  'cut',
  'drop',
  'compositionstart',
  'pointerdown',
] as const;
