import React from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, View } from 'react-native';

/**
 * The web stand-in for the native bottom sheet. See ModalSheet.tsx for why.
 *
 * WHAT IT KEEPS: the presentation (a panel of the given height pinned to the
 * bottom, over a scrim that dismisses on click) and the exact prop shape, so
 * the two call sites stay one piece of code rather than forking.
 *
 * WHAT IT DROPS, and says so rather than faking: the drag-to-dismiss gesture
 * and the detent physics. Both are the native sheet's reason for existing, and
 * a JS re-implementation of them would be a second, worse sheet to maintain.
 * On a desktop browser there is no thumb to drag with anyway -- the scrim and
 * the sheet's own close button are the real dismissal routes there.
 */
export interface ModalBottomSheetProps {
  children?: React.ReactNode;
  /** Points, matching the native prop. Index 0 is closed by convention here. */
  detents?: (number | string)[];
  index?: number;
  onSettle?: (index: number) => void;
  scrimColor?: string;
  surface?: React.ReactNode;
  /** Native-only; accepted and ignored so the call sites do not branch. */
  nativeOverlay?: boolean;
}

export function ModalBottomSheet({
  children,
  detents,
  index = 0,
  onSettle,
  scrimColor = 'rgba(0,0,0,0.4)',
  surface,
}: ModalBottomSheetProps) {
  if (index <= 0) return null;

  // Only the numeric detents are meaningful here; 'content' and friends would
  // need the native measurement pass, so they fall back to filling the screen.
  const detent = detents?.[index];
  const height = typeof detent === 'number' ? detent : '80%';

  /**
   * PORTALLED TO `document.body`, and `position: fixed` alone was not enough.
   *
   * The first version used `fixed` on the sheet's own View, reasoning that
   * every react-native-web View is `position: relative` and so a merely
   * absolute overlay would be trapped in whichever pane rendered it. That
   * reasoning was right and the fix was still wrong, because of a CSS rule it
   * did not account for: **a transformed ancestor becomes the containing block
   * for `position: fixed`.** The list and folder panes animate with transforms,
   * so `fixed` resolved against the pane instead of the viewport.
   *
   * The symptom, from Adam on the installed PWA: Settings opened *inside the
   * note-list column*, spanning the folder and list panes and sitting under the
   * editor, so it could not be reached. It looked like a z-index problem and
   * was a containing-block problem.
   *
   * A portal takes the DOM node out of the pane subtree entirely, so there is
   * no transformed ancestor left to capture it. `fixed` is kept because the
   * portal host is `document.body`, which scrolls.
   *
   * Native is unaffected -- it never reaches this file.
   */
  const overlay = (
    <View style={[styles.root, { position: 'fixed' } as any]} pointerEvents="box-none">
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => onSettle?.(0)}
      />
      <View style={[styles.sheet, { height }]}>
        {surface ? <View style={StyleSheet.absoluteFill}>{surface}</View> : null}
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </View>
  );

  // Guarded because the web bundle is also what the export/prerender path
  // evaluates, where there is no document to portal into.
  if (typeof document === 'undefined' || !document.body) return overlay;
  return createPortal(overlay, document.body);
}

const styles = StyleSheet.create({
  root: { top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
});
