import { describe, it, expect } from './harness';
import {
  SEARCH_FULL,
  SEARCH_MIN,
  fixedWidth,
  minBarWidth,
  topBarLayout,
} from '../lib/layout/desktopTopBar';
import { SURFACE } from '../lib/layout/chromeMetrics';

const at = (barWidth: number | null, leftCount = 1) => topBarLayout({ barWidth, leftCount });

describe('topBarLayout — the bug this fixes, in numbers measured in a browser', () => {
  it('412px (a 1024-wide window, both panes open) is a search BUTTON, not an overlap', () => {
    // This width drew four formatting icons underneath Share / More / Search.
    expect(at(412).form).toBe('button');
  });

  it('540px (a 1152-wide window) narrows the field instead of crowding it', () => {
    expect(at(540).form).toBe('narrow');
  });

  it('668px (a 1280-wide window) is the designed bar', () => {
    expect(at(668)).toEqual({ form: 'full', searchWidth: SEARCH_FULL });
  });
});

describe('topBarLayout — boundaries', () => {
  const fixed = fixedWidth(1);

  it('full starts exactly where the full field fits', () => {
    expect(at(fixed + SEARCH_FULL).form).toBe('full');
    expect(at(fixed + SEARCH_FULL - 1).form).toBe('narrow');
  });

  it('narrow gives the field exactly what is left, down to the minimum', () => {
    expect(at(fixed + 150)).toEqual({ form: 'narrow', searchWidth: 150 });
    expect(at(fixed + SEARCH_MIN)).toEqual({ form: 'narrow', searchWidth: SEARCH_MIN });
    expect(at(fixed + SEARCH_MIN - 1).form).toBe('button');
  });

  it('not measured yet: the designed form, not a collapsed one', () => {
    expect(at(null)).toEqual({ form: 'full', searchWidth: SEARCH_FULL });
  });
});

describe('topBarLayout — whatever it returns FITS', () => {
  it('fixed parts plus the search surface never exceed the bar, from the minimum up', () => {
    for (const leftCount of [1, 2]) {
      for (let barWidth = minBarWidth(leftCount); barWidth <= 1600; barWidth++) {
        const { searchWidth } = at(barWidth, leftCount);
        if (fixedWidth(leftCount) + searchWidth > barWidth) {
          throw new Error(`overflow at barWidth=${barWidth}, leftCount=${leftCount}`);
        }
      }
    }
    expect(true).toBe(true);
  });

  it('the minimum is the button form with nothing to spare', () => {
    expect(at(minBarWidth(1))).toEqual({ form: 'button', searchWidth: SURFACE });
    expect(minBarWidth(1)).toBe(fixedWidth(1) + SURFACE);
  });

  it('a second left-hand button (restore panes) needs more room', () => {
    expect(minBarWidth(2) > minBarWidth(1)).toBe(true);
  });
});
