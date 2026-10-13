import { describe, it, expect } from './harness';
import { initialSheetMount, reduceSheetMount, type SheetMountState } from '../lib/layout/sheetMount';

const run = (state: SheetMountState, ...events: Parameters<typeof reduceSheetMount>[1][]) =>
  events.reduce(reduceSheetMount, state);
const render = (open: boolean) => ({ type: 'render', open }) as const;
const settle = (index: number) => ({ type: 'settle', index }) as const;

describe('sheet mounting — the Android untappable-sheet fix', () => {
  it('starts unmounted when closed: nothing to measure at zero size', () => {
    expect(initialSheetMount(false).mounted).toBe(false);
    expect(run(initialSheetMount(false), render(false)).mounted).toBe(false);
  });

  it('mounts the moment it is asked to open', () => {
    expect(run(initialSheetMount(false), render(true)).mounted).toBe(true);
  });

  it('closed by the parent: stays mounted until it settles, so the animation plays', () => {
    const closing = run(initialSheetMount(false), render(true), settle(1), render(false));
    expect(closing.mounted).toBe(true);
    expect(run(closing, settle(0), render(false)).mounted).toBe(false);
  });

  it('dragged closed before the parent knows: unmounts once the parent catches up', () => {
    const dragged = run(initialSheetMount(false), render(true), settle(1), settle(0));
    // The parent still says open on this render; do not yank it out from under it.
    expect(run(dragged, render(true)).mounted).toBe(true);
    expect(run(dragged, render(false)).mounted).toBe(false);
  });

  it('reopened in the middle of closing: stays mounted', () => {
    const state = run(initialSheetMount(false), render(true), settle(1), render(false), render(true));
    expect(state.mounted).toBe(true);
  });

  it('a second open-close cycle animates out too (settled flag is reset on mount)', () => {
    const reopened = run(
      initialSheetMount(false),
      render(true), settle(1), render(false), settle(0), render(false), // first cycle, unmounted
      render(true)
    );
    expect(reopened).toEqual({ mounted: true, settledClosed: false });
    expect(run(reopened, settle(1), render(false)).mounted).toBe(true);
  });

  it('returns the same object when nothing changes', () => {
    const open = run(initialSheetMount(false), render(true));
    expect(reduceSheetMount(open, render(true))).toBe(open);
    expect(reduceSheetMount(open, settle(1))).toBe(open);
  });
});
