/**
 * The bottom sheet, behind a platform seam.
 *
 * `@swmansion/react-native-bottom-sheet` is a Fabric component with no web
 * implementation: importing it on web reaches `codegenNativeComponent`, which
 * react-native-web does not provide, and the bundle dies with
 * `(0, _reactNativeWebDistIndex.codegenNativeComponent) is not a function`
 * before any app code runs. That took web from working (Stage 12g) back to a
 * red error screen the moment 12.5 swapped both sheets onto the native one --
 * caught by running the browser, which is exactly why the browser is in the
 * verification loop rather than treated as the platform nobody checks.
 *
 * A `.web.tsx` sibling is the whole fix: Metro resolves the platform file, so
 * the native module is never in the web bundle at all. Guarding at the call
 * site would not have worked -- the throw is at import.
 */
import React, { useState } from 'react';
import { Platform } from 'react-native';
import {
  ModalBottomSheet as NativeModalBottomSheet,
  type ModalBottomSheetProps,
} from '@swmansion/react-native-bottom-sheet';

import { initialSheetMount, reduceSheetMount } from '@/lib/layout/sheetMount';

/**
 * The app's bottom sheet. Same props as the library's.
 *
 * iOS: the library's component, untouched.
 *
 * Android: MOUNTED ONLY WHILE OPEN (plus the closing animation). A sheet that
 * stays mounted while closed and is opened by changing `index` -- which is how
 * every sheet in this app is written -- ends up with a 0x0 content wrapper on
 * Android: drawn, but untappable and invisible to screen readers. The full
 * story and the lifecycle rule are in lib/layout/sheetMount.ts.
 *
 * What this changes for callers: nothing they wrote. State kept in the
 * component that RENDERS the sheet survives a close as before; only state
 * inside the sheet's children starts fresh on each open, on Android.
 */
export function ModalBottomSheet(props: ModalBottomSheetProps) {
  if (Platform.OS !== 'android') return <NativeModalBottomSheet {...props} />;
  return <AndroidModalBottomSheet {...props} />;
}

function AndroidModalBottomSheet(props: ModalBottomSheetProps) {
  const open = props.index > 0;
  const [stored, setStored] = useState(() => initialSheetMount(open));

  // Derived during render, React's documented pattern for state that follows a
  // prop: an effect would paint one frame of the old answer first, which here
  // is a frame with no sheet on the way in.
  const state = reduceSheetMount(stored, { type: 'render', open });
  if (state !== stored) setStored(state);

  if (!state.mounted) return null;

  return (
    <NativeModalBottomSheet
      {...props}
      onSettle={(index) => {
        setStored((current) => reduceSheetMount(current, { type: 'settle', index }));
        props.onSettle?.(index);
      }}
    />
  );
}
