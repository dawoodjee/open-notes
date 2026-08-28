import { describe, it, expect } from './harness';
import {
  folderPanePresentation,
  presentationDiffersByPlatform,
} from '../lib/layout/folderPane';

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

describe('the iOS/Android asymmetry, pinned rather than fixed', () => {
  it('an Android tablet in portrait disagrees with an iPad of the same size', () => {
    // Same window, same shape, different answer -- because the condition is
    // written against iOS rather than against the shape of the window. This
    // test does not endorse it; it makes it visible so the choice is
    // deliberate. Flagged for Adam.
    expect(presentationDiffersByPlatform(IPAD_PORTRAIT.width, IPAD_PORTRAIT.height)).toBe(true);
    expect(folderPanePresentation({ ...IPAD_PORTRAIT, platform: 'android' })).toBe('persistent');
  });

  it('they agree in landscape and on phones', () => {
    expect(presentationDiffersByPlatform(IPAD_LANDSCAPE.width, IPAD_LANDSCAPE.height)).toBe(false);
    expect(presentationDiffersByPlatform(IPHONE_PORTRAIT.width, IPHONE_PORTRAIT.height)).toBe(false);
  });
});
