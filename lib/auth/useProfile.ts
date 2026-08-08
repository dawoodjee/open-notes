import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { withTimeout } from './withTimeout';

export interface Profile {
  username: string | null;
  full_name: string | null;
  username_changed_at: string | null;
}

// profiles isn't a PowerSync table (see lib/powersync/schema.ts's comment on
// why) -- it's account metadata, not offline-critical note content, so this
// reads it directly via supabase-js rather than through the local db.
export function useProfile() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!session) {
      setProfile(null);
      return;
    }
    setIsLoading(true);
    setError(null);
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
      setProfile(data ?? null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load profile');
    }
    setIsLoading(false);
  }, [session]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { profile, isLoading, error, refetch };
}
