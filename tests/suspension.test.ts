import { describe, it, expect } from './harness';
import { resolvePending, type Pending } from '../lib/account/suspension';

const row: Pending = { requestedAt: '2026-09-29T00:00:00Z', purgeAfter: '2026-10-29T00:00:00Z' };
const justAsked: Pending = { requestedAt: '2026-09-29T01:00:00Z', purgeAfter: '2026-10-29T01:00:00Z' };
const idle = { requested: null, cancelled: false, erasedNotice: false };

describe('resolvePending — is this device suspended?', () => {
  it('no row, no overrides: not suspended', () => {
    expect(resolvePending(null, idle)).toBe(null);
  });

  it('the synced row alone suspends the device', () => {
    expect(resolvePending(row, idle)).toEqual(row);
  });

  it('just requested: suspended at once, before the row syncs down', () => {
    expect(resolvePending(null, { ...idle, requested: justAsked })).toEqual(justAsked);
  });

  it('just cancelled: NOT suspended although the local row is still there', () => {
    // Otherwise the device would stay disconnected, so sync could never remove
    // the row that is keeping it disconnected -- a deadlock.
    expect(resolvePending(row, { ...idle, cancelled: true })).toBe(null);
  });

  it('cancelled wins over a stale request override', () => {
    expect(resolvePending(row, { ...idle, requested: justAsked, cancelled: true })).toBe(null);
  });
});
