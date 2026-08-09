import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { withTimeout } from './withTimeout';

export interface Profile {
  username: string | null;
  full_name: string | null;
  username_changed_at: string | null;
}

interface ProfileState {
  profile: Profile | null;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// One shared store, not per-component state.
//
// This hook is used in two places at once: the avatar badge and the Manage
// Account dialog. With plain useState inside the hook, each caller got its own
// private copy -- so saving a full name in the dialog refreshed the dialog's
// copy and the avatar kept rendering the old initials until something else
// happened to remount it. The data is per-account, not per-component, so it
// belongs in one place that every caller reads from.
//
// useSyncExternalStore is React's built-in way to subscribe a component to a
// value that lives outside React. Three pieces: subscribe (register a callback
// to run on change, return an unsubscribe), getSnapshot (read the current
// value), and the rule that the snapshot must be reference-stable -- returning
// a fresh object each read would make React think it changed every time and
// re-render forever. Hence `state` is replaced only inside setState.
// ---------------------------------------------------------------------------

let state: ProfileState = { profile: null, isLoading: false, error: null };
const listeners = new Set<() => void>();

function setState(next: Partial<ProfileState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

/** Drop the cached profile on sign-out, so the next account never briefly
 *  renders the previous one's name. */
export function clearProfileCache() {
  setState({ profile: null, isLoading: false, error: null });
}

// profiles isn't a PowerSync table (see lib/powersync/schema.ts's comment on
// why) -- it's account metadata, not offline-critical note content, so this
// reads it directly via supabase-js rather than through the local db.
export function useProfile() {
  const { session } = useAuth();
  const { profile, isLoading, error } = useSyncExternalStore(subscribe, getSnapshot);

  const refetch = useCallback(async () => {
    if (!session) {
      clearProfileCache();
      return;
    }
    setState({ isLoading: true, error: null });
    try {
      const { data, error: fetchError } = await withTimeout(
        supabase
          .from('profiles')
          .select('username, full_name, username_changed_at')
          .eq('id', session.user.id)
          .single(),
        8000,
        'Loading profile'
      );
      if (fetchError) throw fetchError;
      setState({ profile: data ?? null, isLoading: false });
    } catch (err: any) {
      setState({ error: err.message ?? 'Failed to load profile', isLoading: false });
    }
  }, [session]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { profile, isLoading, error, refetch };
}
