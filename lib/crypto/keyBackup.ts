import { supabase } from '@/lib/supabase/client';
import { KdfParams } from './keys';

/**
 * Reading and writing public.user_keys -- the account's data key, wrapped
 * under its recovery code.
 *
 * Read directly through supabase-js rather than PowerSync, for the same
 * reason profiles is: this is account metadata, not offline-critical note
 * content, and it is needed exactly once per device at sign-in. Putting it in
 * a sync bucket would replicate key material to every device continuously for
 * no benefit.
 */

export interface AccountKeyRecord {
  recoveryWrappedKey: string;
  recoverySalt: string;
  kdfParams: KdfParams;
  fingerprint: string;
}

export async function fetchAccountKey(userId: string): Promise<AccountKeyRecord | null> {
  const { data, error } = await supabase
    .from('user_keys')
    .select('recovery_wrapped_key, recovery_salt, kdf_params, key_fingerprint')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    recoveryWrappedKey: data.recovery_wrapped_key,
    recoverySalt: data.recovery_salt,
    kdfParams: data.kdf_params as KdfParams,
    fingerprint: data.key_fingerprint,
  };
}

/**
 * Claims this device's key as the account's. Only succeeds when the account
 * has no key yet.
 *
 * user_keys has no UPDATE policy on purpose, so a second insert fails with a
 * 23505 unique violation rather than silently replacing the row. That
 * matters: overwriting would orphan every note already encrypted under the
 * previous key. The race it guards against is real -- two devices signing
 * into a brand-new account at the same moment -- and the loser must adopt
 * rather than overwrite.
 */
export async function uploadAccountKey(
  userId: string,
  payload: {
    wrappedByRecoveryCode: string;
    recoverySalt: string;
    kdfParams: KdfParams;
    fingerprint: string;
  }
): Promise<{ claimed: boolean }> {
  const { error } = await supabase.from('user_keys').insert({
    user_id: userId,
    recovery_wrapped_key: payload.wrappedByRecoveryCode,
    recovery_salt: payload.recoverySalt,
    kdf_params: payload.kdfParams,
    key_fingerprint: payload.fingerprint,
  });

  if (!error) return { claimed: true };
  // Someone got there first -- the caller should adopt what's there.
  if (error.code === '23505') return { claimed: false };
  throw error;
}
