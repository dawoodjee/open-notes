import { describe, it, expect } from './harness';
import { isValidSettingKey, settingRowId } from '../lib/settings/settingRowId';
import {
  ALL_SETTING_KEYS,
  APPEARANCE_KEY,
  APP_THEME_KEY,
  BULLET_STYLE_KEY,
  LEGACY_KEY,
  LOCK_SETTINGS_KEY,
} from '../lib/settings/settingKeys';

const USER_A = '7f7dfe9f-78d4-47f2-bfb2-58ac6225a4d3';
const USER_B = '11111111-2222-3333-4444-555555555555';

describe('settingRowId', () => {
  it('is stable for the same user and key', () => {
    expect(settingRowId(USER_A, 'lock.v1')).toBe(settingRowId(USER_A, 'lock.v1'));
  });

  it('differs per key', () => {
    const same = settingRowId(USER_A, 'lock.v1') === settingRowId(USER_A, 'appearance.v1');
    expect(same).toBe(false);
  });

  it('differs per user, so two accounts never collide on one row', () => {
    const same = settingRowId(USER_A, 'lock.v1') === settingRowId(USER_B, 'lock.v1');
    expect(same).toBe(false);
  });

  it('is a structurally valid RFC-4122 uuid, because the column is `uuid`', () => {
    const id = settingRowId(USER_A, 'lock.v1');
    const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
    expect(valid).toBe(true);
  });

  it('does not confuse a user:key split', () => {
    // "a:b" + "c" and "a" + "b:c" must not hash to the same row -- the naive
    // concatenation bug, which would let one setting overwrite another.
    const same = settingRowId('a:b', 'c') === settingRowId('a', 'b:c');
    expect(same).toBe(false);
  });
});

describe('isValidSettingKey', () => {
  it('accepts every key this app ships', () => {
    expect(ALL_SETTING_KEYS.every(isValidSettingKey)).toBe(true);
  });

  it('REJECTS camelCase, which is the trap this guard exists for', () => {
    // `bulletStyle.v1` is the obvious name, type-checks, and writes to the
    // local mirror happily -- then Postgres rejects it on upload, where a
    // constraint violation is not classified as structural and so retries
    // forever, jamming every operation queued behind it.
    expect(isValidSettingKey('bulletStyle.v1')).toBe(false);
  });

  it('rejects the other shapes the column constraint forbids', () => {
    const bad = ['', 'Bad Key', 'has space.v1', '.leading', 'trailing.', 'a..b', 'under_score.v1'];
    expect(bad.some(isValidSettingKey)).toBe(false);
  });

  it('rejects a key longer than the column allows', () => {
    expect(isValidSettingKey('a'.repeat(65))).toBe(false);
    expect(isValidSettingKey('a'.repeat(64))).toBe(true);
  });
});

describe('LEGACY_KEY — the pre-13c fallback adoption depends on', () => {
  it('covers every setting that existed before 13c', () => {
    // The bug this catches: adoption reads the MIRROR, and a preference set
    // before 13c is only in the legacy key. A missing entry here means that
    // setting reads correctly on its own device and NEVER syncs -- silently,
    // forever, until the user happens to change it. Observed as a phone showing
    // dark next to a tablet showing light, with an empty settings table.
    expect([APPEARANCE_KEY, APP_THEME_KEY, BULLET_STYLE_KEY].map((k) => LEGACY_KEY[k])).toEqual([
      'notes.appearance.v1',
      'notes.theme.v1',
      'notes.bulletStyle.v1',
    ]);
  });

  it('has no entry for the lock, which never had a standalone key', () => {
    // The lock lived inside the vault blob, so there is nothing to adopt from.
    // An invented entry would send adoption looking for a key that never existed.
    expect(LEGACY_KEY[LOCK_SETTINGS_KEY] ?? 'none').toBe('none');
  });

  it('maps only to legacy names, never to a mirror name', () => {
    // `notes.settings.*` is the MIRROR namespace. A legacy entry pointing there
    // would make adoption read the very key it is meant to be falling back from.
    const wrong = Object.values(LEGACY_KEY).filter((v) => v.startsWith('notes.settings.'));
    expect(wrong).toEqual([]);
  });
});
