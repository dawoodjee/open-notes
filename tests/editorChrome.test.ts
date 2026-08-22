/**
 * Which chrome the editor wears — and specifically, what Split View does to it.
 *
 * Split View is the checkpoint requirement that is hardest to drive from a
 * script (a drag out of the Dock, on a multitasking model iPadOS 26 rebuilt).
 * What it does to this app is make the window narrow, so that is what gets
 * asserted.
 */
import { describe, it, expect } from './harness';
import { editorChrome, WIDE_LAYOUT_MIN_WIDTH } from '../lib/layout/editorChrome';

const pad = (width: number) => editorChrome({ width, platform: 'ios', isPad: true });
const phone = (width: number) => editorChrome({ width, platform: 'ios', isPad: false });
const web = (width: number) => editorChrome({ width, platform: 'web', isPad: false });

describe('editorChrome — Split View', () => {
  it('A NARROW SPLIT VIEW PANE GETS THE PHONE CHROME, iPad or not', () => {
    // The trap: `isPad` is still true in Split View. A rule written as "iPad
    // gets the iPad bar" would hand a 507pt pane a bar laid out for a full
    // screen -- four circles, a capsule and the gaps between them.
    expect(pad(507)).toBe('phone'); // half of a 13" iPad in portrait
    expect(pad(320)).toBe('phone'); // the narrowest pane iPadOS offers
  });

  it('a wide Split View pane keeps the iPad chrome', () => {
    expect(pad(880)).toBe('pad'); // two-thirds of a 13" iPad in landscape
  });

  it('full screen, both orientations', () => {
    expect(pad(1032)).toBe('pad'); // portrait
    expect(pad(1376)).toBe('pad'); // landscape
  });
});

describe('editorChrome — the other platforms', () => {
  it('web wide is desktop, web narrow is the phone chrome', () => {
    expect(web(1280)).toBe('desktop');
    // A browser window dragged narrow is the web's own Split View.
    expect(web(600)).toBe('phone');
  });

  it('AN iPHONE IN LANDSCAPE IS STILL A PHONE', () => {
    // A Pro Max in landscape is 932pt -- comfortably over the threshold, and
    // emphatically not an iPad. Width alone would get this wrong, which is why
    // the platform test comes after it rather than instead of it.
    expect(phone(932)).toBe('phone');
  });

  it('the threshold is exclusive at the bottom and inclusive at the top', () => {
    expect(pad(WIDE_LAYOUT_MIN_WIDTH - 1)).toBe('phone');
    expect(pad(WIDE_LAYOUT_MIN_WIDTH)).toBe('pad');
  });
});
