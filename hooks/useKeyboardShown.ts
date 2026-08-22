import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether a software keyboard is currently on screen.
 *
 * The two platforms fire different events and only one pair is reliable on
 * each: iOS gets `keyboardWillShow`/`keyboardWillHide`, which fire with the
 * animation and so keep the layout in step with it, while Android only has the
 * `did` variants.
 *
 * Lives here rather than inside a component because two now need it and they
 * have to agree: `NoteEditorPane` shows Done only while the keyboard is up, and
 * `RichEditor` shows the formatting bar on the same condition. Two copies of
 * this would eventually disagree by a frame on one platform, and the symptom --
 * a bar and a button that appear at slightly different moments -- reads as
 * jank rather than as a bug anybody would go looking for.
 *
 * A HARDWARE keyboard fires none of these, which is correct for what the
 * callers ask: they want to know whether the software keyboard is taking up
 * screen space, not whether the user can type. Callers that also need "is the
 * user working in the text" pair this with a selection or focus signal.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const subs = [
      Keyboard.addListener(showEvent, () => setShown(true)),
      Keyboard.addListener(hideEvent, () => setShown(false)),
    ];

    return () => subs.forEach((s) => s.remove());
  }, []);

  return shown;
}
