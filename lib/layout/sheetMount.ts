/**
 * When a bottom sheet should be MOUNTED on Android, as opposed to merely shown.
 *
 * WHY THIS EXISTS. `@swmansion/react-native-bottom-sheet` (0.16.2) places its
 * own children on Android rather than letting React Native do it. Our sheets
 * used to be mounted once while closed and opened later by changing `index`.
 * Closed, the content area measures as zero; opened, it gets its real size --
 * but the library never re-runs its placement step, so its content wrapper
 * keeps native bounds of 0x0. Android still DRAWS children that spill out of a
 * zero-size parent, so the sheet looked perfect, and hit-testing cannot descend
 * into a zero-size view, so nothing in it could be tapped or read by a screen
 * reader. Found on a Galaxy S21: Settings opened and was completely dead.
 *
 * The library's source describes this failure for content that is ADDED after
 * layout (its issue #48) and fixes that case only; ours is content RESIZED
 * after layout.
 *
 * THE RULE. Mount the sheet when it is asked to open, so its wrapper is
 * measured at real size from the start, and keep it mounted until it has
 * SETTLED closed, so the closing animation still plays.
 *
 * Pure, so the lifecycle -- including a reopen in the middle of closing, and a
 * drag-to-close the parent has not heard about yet -- is tested without a
 * device. See components/ModalSheet.tsx for the one place it is used.
 */
export interface SheetMountState {
  mounted: boolean;
  /** The native sheet has reported settling at its closed detent. */
  settledClosed: boolean;
}

export type SheetMountEvent =
  /** The component rendered, with the parent wanting it open or closed. */
  | { type: 'render'; open: boolean }
  /** The native sheet came to rest at this detent index (0 = closed). */
  | { type: 'settle'; index: number };

export function initialSheetMount(open: boolean): SheetMountState {
  return { mounted: open, settledClosed: !open };
}

/** Returns the SAME object when nothing changes, so callers can compare by identity. */
export function reduceSheetMount(state: SheetMountState, event: SheetMountEvent): SheetMountState {
  if (event.type === 'settle') {
    const settledClosed = event.index === 0;
    return settledClosed === state.settledClosed ? state : { ...state, settledClosed };
  }

  if (event.open) {
    // A fresh mount starts un-settled, or the next close would unmount at once
    // and skip its animation.
    return state.mounted ? state : { mounted: true, settledClosed: false };
  }

  // Closed. Stay mounted until the sheet has actually come to rest.
  if (state.mounted && state.settledClosed) return { mounted: false, settledClosed: true };
  return state;
}
