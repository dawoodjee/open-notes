import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import 'react-native-get-random-values';

// Expo SecureStore caps values at ~2KB -- and a real Supabase session is
// already over that on its own (measured ~1.9KB for a single-identity local
// test account; Phase 3 adds linked identities, which only grows the
// session's `user.identities` array further). So the session itself can't
// live in SecureStore directly. This is Supabase's own documented fix, not
// one I improvised: generate a random AES-256 key, store *only that key*
// (32 bytes, far under the limit) in SecureStore, and keep the
// (unlimited-size) encrypted session blob in AsyncStorage. The session still
// ends up encrypted-at-rest -- the key never leaves the Keychain/Keystore --
// while sidestepping the size cap entirely.
//
// One deviation from Supabase's published version of this adapter: their
// example mints a *fresh* AES key on every write, stored under the same name
// as the value it protects. Since supabase-js re-persists the session on
// every token refresh, that means a Keychain write roughly hourly plus one
// per sign-in. Here it's a single key under a fixed name of its own,
// generated once and read once per launch, so SecureStore is touched twice in
// the app's lifetime instead of continuously. Same security property either
// way -- the key never leaves the Keychain/Keystore, and the session blob in
// AsyncStorage is useless without it.
//
// Worth recording what this is NOT: for a while this adapter was believed to
// be the cause of supabase.auth.getSession() hanging forever, because
// swapping in plain AsyncStorage made the hang disappear. It didn't. The real
// cause was a re-entrant call into supabase-js from inside its own
// onAuthStateChange callback (see contexts/AuthContext.tsx) -- changing the
// storage backend only shifted the timing enough to usually win the race.
// The fix above is a genuine improvement to Keychain traffic; it was never
// the bug.
const ENCRYPTION_KEY_NAME = 'notes.session.encryption.key.v1';

let encryptionKeyPromise: Promise<string> | null = null;

// Memoized on the promise, not the resolved value: two callers arriving
// before the first read finishes must await the same native call rather than
// each issuing their own -- which is the access pattern that hangs.
function getEncryptionKey(): Promise<string> {
  if (!encryptionKeyPromise) {
    encryptionKeyPromise = (async () => {
      const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_NAME);
      if (existing) return existing;

      const created = aesjs.utils.hex.fromBytes(crypto.getRandomValues(new Uint8Array(256 / 8)));
      await SecureStore.setItemAsync(ENCRYPTION_KEY_NAME, created);
      return created;
    })();
  }
  return encryptionKeyPromise;
}

class LargeSecureStore {
  private async _encrypt(value: string) {
    const keyHex = await getEncryptionKey();
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(keyHex),
      new aesjs.Counter(1)
    );
    return aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes(value)));
  }

  private async _decrypt(value: string) {
    const keyHex = await getEncryptionKey();
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(keyHex),
      new aesjs.Counter(1)
    );
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) {
      return encrypted;
    }
    try {
      return await this._decrypt(encrypted);
    } catch {
      // Undecryptable -- the key was cleared out from under the blob, or
      // the blob predates this adapter. Treat it as no stored session
      // (worst case: one extra sign-in) rather than throwing on every
      // single auth call forever, which is what an unhandled AES failure
      // here does.
      await AsyncStorage.removeItem(key);
      return null;
    }
  }

  async removeItem(key: string) {
    // Deliberately does not delete the encryption key: it's shared by every
    // entry this adapter stores, and supabase-js calls removeItem on sign-out
    // for individual keys. Dropping it would render any other entry
    // unreadable, and the key protects nothing once its ciphertext is gone.
    await AsyncStorage.removeItem(key);
  }

  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, await this._encrypt(value));
  }
}

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: new LargeSecureStore(),
      autoRefreshToken: true,
      persistSession: true,
      // RN has no URL bar for an OAuth redirect to land in -- the deep link
      // (`notes://`) is handled explicitly via expo-web-browser instead.
      detectSessionInUrl: false,
    },
  }
);
