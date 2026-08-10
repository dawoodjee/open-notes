import { useEffect, useState } from 'react';
import { getPowerSync } from '@/lib/powersync/db';
import { interpretGateValue } from './policy';

/**
 * Whether the API access gate is currently open, live.
 *
 * WATCHES ui_state RATHER THAN READING IT ONCE, and that is the whole point.
 * The gate is toggled in a settings sheet and consumed in the note menu --
 * two places with no component ancestry between them. A one-shot read would
 * leave the menu stale until the editor happened to remount, so turning the
 * setting on would look like it had not worked.
 *
 * ui_state is a PowerSync table, so a watch gives that for free and needs no
 * new plumbing -- the same pattern AdvancedView already uses for sync_issues.
 *
 * Note this reports whether the GATE is open, not whether any particular note
 * is visible. A note's own is_hidden_from_api travels on the note itself.
 */
export function useApiGateOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    getPowerSync().watch(
      'SELECT api_gate_expires_at FROM ui_state WHERE id = ?',
      ['singleton'],
      {
        onResult: (result) => {
          const value = (result.rows?._array?.[0] as any)?.api_gate_expires_at ?? null;
          // Reuses the same interpreter the broker relies on, so the menu can
          // never disagree with what a request would actually do -- including
          // treating a lapsed expiry as closed.
          setOpen(interpretGateValue(value).enabled);
        },
        onError: (err) => console.error('api gate watch error:', err),
      },
      { signal: abortController.signal }
    );
    return () => abortController.abort();
  }, []);

  return open;
}
