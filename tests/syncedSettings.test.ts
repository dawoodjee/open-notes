import { describe, it, expect } from './harness';
import { settingRowId } from '../lib/settings/settingRowId';

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
