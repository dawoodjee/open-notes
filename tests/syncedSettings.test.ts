import { describe, it, expect } from './harness';
import { isValidSettingKey, settingRowId } from '../lib/settings/settingRowId';

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
  // These are the keys the app actually ships. Listed literally rather than
  // imported, because syncedSettings.ts reaches react-native through
  // secureStorage and the harness runs under plain Node -- see settingRowId.ts.
  const SHIPPED = ['lock.v1', 'appearance.v1', 'theme.v1', 'bulletstyle.v1'];

  it('accepts every key this app ships', () => {
    expect(SHIPPED.every(isValidSettingKey)).toBe(true);
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
