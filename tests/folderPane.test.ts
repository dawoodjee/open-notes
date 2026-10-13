import { describe, it, expect } from './harness';
import {
  DESKTOP_PINNED_FOLDERS_MIN_WIDTH,
  folderPanePresentation,
  presentationDiffersByPlatform,
} from '../lib/layout/folderPane';
import { minBarWidth } from '../lib/layout/desktopTopBar';

/**
 * Real device dimensions in POINTS, so a failure names a device rather than a
 * number. iPad Pro 13-inch (M5) is the simulator this project actually uses.
 */
const IPAD_PORTRAIT = { width: 1032, height: 1376 };
const IPAD_LANDSCAPE = { width: 1376, height: 1032 };
const IPHONE_PORTRAIT = { width: 402, height: 874 };
const IPHONE_LANDSCAPE = { width: 874, height: 402 };
const DESKTOP = { width: 1280, height: 860 };

const onIos = (d: { width: number; height: number }) =>
  folderPanePresentation({ ...d, platform: 'ios' });

describe('folderPanePresentation — the iPad rule, unverified since Stage 11', () => {
  it('iPad landscape pushes the content aside', () => {
    expect(onIos(IPAD_LANDSCAPE)).toBe('persistent');
  });

  it('iPad portrait floats over the content', () => {
    // The claim that has never been confirmed on a device, because simctl
    // cannot rotate a simulator. It is decidable without one.
    expect(onIos(IPAD_PORTRAIT)).toBe('overlay');
  });

  it('a phone navigates to the folder pane', () => {
    expect(onIos(IPHONE_PORTRAIT)).toBe('navigation');
  });

  it('DOCUMENTS why the iPhone orientation lock is load-bearing', () => {
    // A landscape iPhone 17 Pro is 874pt wide -- comfortably over the 768
    // breakpoint -- so this rule would hand a 402pt-TALL phone the full
    // three-pane tablet layout, folder column and all.
    //
    // That never happens today, and not by luck: ios/notes/Info.plist lists
    // only Portrait and PortraitUpsideDown under
    // UISupportedInterfaceOrientations, with all four allowed under the ~ipad
    // variant. The lock is what makes the 768 threshold safe on phones.
    //
    // Asserted rather than assumed, so that enabling landscape on iPhone
    // fails HERE -- with this comment attached -- instead of shipping a
    // three-pane phone.
    expect(onIos(IPHONE_LANDSCAPE)).toBe('persistent');
  });

  it('desktop is always persistent', () => {
    expect(folderPanePresentation({ ...DESKTOP, platform: 'web' })).toBe('persistent');
  });
});

describe('folderPanePresentation — Split View, which is why width beats device', () => {
  // Widths an iPad Pro 13 actually hands an app in Split View, against the
  // landscape height. Asking "is this an iPad" gets all three wrong.
  it('a narrow Split View pane behaves like a phone', () => {
    expect(onIos({ width: 320, height: 1032 })).toBe('navigation');
    expect(onIos({ width: 507, height: 1032 })).toBe('navigation');
  });

  it('a wide Split View pane that is still taller than it is wide floats', () => {
    expect(onIos({ width: 880, height: 1032 })).toBe('overlay');
  });

  it('a Split View pane wider than it is tall gets the real column', () => {
    expect(onIos({ width: 1100, height: 1032 })).toBe('persistent');
  });
});

describe('folderPanePresentation — boundaries', () => {
  it('768 is inclusive', () => {
    expect(onIos({ width: 767, height: 400 })).toBe('navigation');
    expect(onIos({ width: 768, height: 400 })).toBe('persistent');
  });

  it('an exactly square window is not landscape', () => {
    // `width > height`, not `>=`. A square window is the one case where the
    // two readings differ, and overlay is the safer answer -- it never steals
    // width from content that has none to spare.
    expect(onIos({ width: 1000, height: 1000 })).toBe('overlay');
  });
});

describe('uniform across platforms — Adam, 2026-08-28', () => {
  it('an Android tablet matches an iPad of the same size, in both orientations', () => {
    // The rule used to read `platform !== 'ios' || isLandscape`, so a portrait
    // Android tablet got the column while an iPad of identical dimensions got
    // the overlay. Same window, same shape, different answer. Now it answers on
    // shape alone.
    expect(presentationDiffersByPlatform(IPAD_PORTRAIT.width, IPAD_PORTRAIT.height)).toBe(false);
    expect(presentationDiffersByPlatform(IPAD_LANDSCAPE.width, IPAD_LANDSCAPE.height)).toBe(false);
    expect(folderPanePresentation({ ...IPAD_PORTRAIT, platform: 'android' })).toBe('overlay');
  });

  it('no window anywhere is classified by platform', () => {
    // The property itself, asserted over a spread of shapes rather than the two
    // that happened to be interesting -- so re-adding a platform branch fails
    // here regardless of which platform it special-cases.
    const windows = [
      [320, 1032], [507, 1032], [768, 400], [880, 1032],
      [1032, 1376], [1100, 1032], [1280, 860], [1000, 1000], [402, 874],
    ];
    const disagreements = windows.filter(([w, h]) => presentationDiffersByPlatform(w, h));
    expect(disagreements).toEqual([]);
  });

  it('the accepted cost: a taller-than-wide desktop window now floats', () => {
    // Dragging a browser window narrow on a big display used to keep the
    // column and now gets the overlay. That follows from the same reasoning
    // that makes iPad portrait an overlay, and it is the price of uniformity.
    expect(folderPanePresentation({ width: 900, height: 1000, platform: 'web' })).toBe('overlay');
    expect(folderPanePresentation({ width: 1280, height: 860, platform: 'web' })).toBe('persistent');
  });
});

describe('folderPanePresentation — the desktop bar needs room (2026-10-13)', () => {
  const desktop = (width: number, height = 700) =>
    folderPanePresentation({ width, height, platform: 'web', chrome: 'desktop' });

  it('an 800-wide landscape window floats the Folders pane', () => {
    // Measured in a browser: pinned, the bar had 188px and every formatting
    // icon sat underneath Share / More / Search.
    expect(desktop(800)).toBe('overlay');
  });

  it('pinned exactly from the floor, floating one pixel below it', () => {
    expect(desktop(DESKTOP_PINNED_FOLDERS_MIN_WIDTH)).toBe('persistent');
    expect(desktop(DESKTOP_PINNED_FOLDERS_MIN_WIDTH - 1)).toBe('overlay');
  });

  it('at the floor the editor is exactly as wide as the smallest bar', () => {
    // 612 = both columns plus their borders; what is left is the bar.
    expect(DESKTOP_PINNED_FOLDERS_MIN_WIDTH - 612).toBe(minBarWidth(1));
  });

  it('a 1024-wide window keeps both columns (the bar collapses Search instead)', () => {
    expect(desktop(1024)).toBe('persistent');
  });

  it('ordinary desktop sizes are untouched', () => {
    expect(desktop(1280, 860)).toBe('persistent');
    expect(desktop(900, 1000)).toBe('overlay'); // portrait, as before
    expect(desktop(700)).toBe('navigation');
  });

  it('the iPad is NOT affected: a different bar, a verified layout', () => {
    // Landscape and narrower than the desktop floor -- still pinned.
    const pad = (width: number, height: number) =>
      folderPanePresentation({ width, height, platform: 'ios', chrome: 'pad' });
    expect(pad(1000, 700)).toBe('persistent');
    expect(pad(1376, 1032)).toBe('persistent');
    expect(pad(1032, 1376)).toBe('overlay');
  });

  it('with no chrome given, the rule is exactly what it was', () => {
    expect(folderPanePresentation({ width: 800, height: 600, platform: 'web' })).toBe('persistent');
    expect(presentationDiffersByPlatform(800, 600)).toBe(false);
  });
});
