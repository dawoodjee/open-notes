import React from 'react';
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

  return (
    // `fixed`, not `absolute`. Every react-native-web View is position:relative,
    // so an absolutely-filled overlay would be trapped inside whichever pane
    // happens to render the sheet instead of covering the window.
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
}

const styles = StyleSheet.create({
  root: { top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
});
