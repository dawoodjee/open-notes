import { describe, it, expect } from './harness';
import { resolveSetting } from '../lib/settings/resolveSetting';

type Appearance = 'light' | 'dark' | 'system';
const isAppearance = (v: string): v is Appearance =>
  v === 'light' || v === 'dark' || v === 'system';

describe('resolveSetting', () => {
  it('prefers the synced mirror', () => {
    expect(resolveSetting('dark', 'light', isAppearance, 'system')).toBe('dark');
  });

  it('falls back to the pre-13c key when nothing has synced yet', () => {
    // Every existing device on the day 13c ships. Getting this wrong silently
    // resets everyone's appearance on upgrade.
    expect(resolveSetting(null, 'dark', isAppearance, 'system')).toBe('dark');
  });

  it('uses the default only when neither exists', () => {
    expect(resolveSetting(null, null, isAppearance, 'system')).toBe('system');
  });

  it('falls through an INVALID mirror to a valid legacy value', () => {
    // A value from a newer build this binary cannot paint is not a reason to
    // throw away the user's older, still-valid choice.
    expect(resolveSetting('ultraviolet', 'dark', isAppearance, 'system')).toBe('dark');
  });

  it('ignores an invalid legacy value', () => {
    expect(resolveSetting(null, 'chartreuse', isAppearance, 'system')).toBe('system');
  });

  it('distinguishes a stored "system" from nothing stored', () => {
    // The exact pair that made the on-device check worthless: both LOOK like
    // "follows the device" on screen, so only a test can tell them apart.
    expect(resolveSetting(null, 'system', isAppearance, 'light')).toBe('system');
    expect(resolveSetting(null, null, isAppearance, 'light')).toBe('light');
  });
});
