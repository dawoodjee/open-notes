/**
 * The web keychain: IndexedDB, with every value encrypted under a key that
 * script cannot read.
 *
 * ── WHAT THIS REPLACED, AND WHY IT WAS RIGHT AT THE TIME ──────────────────
 *
 * Until Stage 13a this was an in-memory `Map` that died with the tab. That was
 * deliberate, not a shortcut: the items stored here are the device key and the
 * wrapped vault -- the keys that make every note readable -- and the only
 * places to put them on web (`localStorage`, plain IndexedDB) are readable by
 * any script on the origin. Keeping them in memory made "web is session-only" a
 * STRUCTURAL fact rather than a promise, so the at-rest question could not be
 * pre-empted before Stage 13's spike answered it.
 *
 * The spike answered it (`dev-docs/web-at-rest-findings.md`), so the trade the
 * Map existed to avoid can now be made properly.
 *
 * ── THE DESIGN: A NON-EXTRACTABLE KEY, ONE LEVEL UP ───────────────────────
 *
 * WebCrypto can generate a key with `extractable: false` and hand back a
 * `CryptoKey` HANDLE. Structured clone stores that handle in IndexedDB and
 * brings it back across reloads -- but `crypto.subtle.exportKey()` on it throws
 * `InvalidAccessError`, so the raw bytes are never available to JavaScript, not
 * even to this file. The browser holds the material; the page only gets to
 * point at it.
 *
 * The spike proposed this for the database key specifically. It is applied here
 * instead, one level up, so that EVERY value crossing the seam is encrypted and
 * nothing above it has to know or opt in. That is why this file encrypts a
 * theme preference with the same care as the device key: a seam with exceptions
 * is a seam someone forgets to use.
 *
 * The Supabase session token (`lib/supabase/client.ts`) and the plaintext
 * endpoint tokens (`lib/plaintext/endpoints.ts`) come along for free, and both
 * are things the old Map never had to think about because it never wrote them
 * down.
 *
 * ── WHAT IT DOES AND DOES NOT DEFEND ──────────────────────────────────────
 *
 * Defeats disk inspection and key exfiltration: someone copying the browser
 * profile gets ciphertext and a handle that is useless outside this browser.
 *
 * Does NOT defeat script running on the origin. An XSS can simply CALL
 * `getItemAsync` -- non-extractable means "cannot read the bytes", not "cannot
 * use the key". That is web's residual gap versus native and it is stated
 * plainly in the findings doc rather than papered over here.
 */

export type SecureStorageOptions = {
  /** Accepted and ignored: there is no keychain here to be picky about. */
  keychainAccessible?: unknown;
};

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = undefined as unknown as number;

/**
 * False now. Web outlives the tab, so the UI must stop saying otherwise -- see
 * `components/SyncRecoverySection.tsx`, which reads this to decide between
 * "This session only" and "Encrypted on this device".
 */
export const isSessionOnly = false;

const DB_NAME = 'notes-secure-store';
const DB_VERSION = 1;
/** Values, keyed by the caller's key. */
const ITEMS = 'items';
/** Exactly one record: the non-extractable key handle. */
const KEYS = 'keys';
const KEK_ID = 'kek.v1';

/** AES-GCM's standard nonce length. Never reused -- fresh per write. */
const IV_BYTES = 12;

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS);
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openStore().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = body(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      })
  );
}

/**
 * The key-encrypting key, created once per browser profile and never exported.
 *
 * Memoised because every read and write needs it and an IndexedDB round trip
 * per call would put one on the critical path of every settings read at boot.
 * The in-flight promise is memoised rather than the resolved key, so two
 * concurrent first-callers cannot both generate a key and have one silently
 * overwrite the other -- which would leave every value written by the loser
 * permanently undecryptable.
 */
let kekPromise: Promise<CryptoKey> | null = null;

function getKek(): Promise<CryptoKey> {
  if (kekPromise) return kekPromise;
  kekPromise = (async () => {
    const existing = await run<CryptoKey | undefined>(KEYS, 'readonly', (s) => s.get(KEK_ID));
    if (existing) return existing;

    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await run(KEYS, 'readwrite', (s) => s.put(created, KEK_ID));
    return created;
  })();
  return kekPromise;
}

/**
 * `{iv, data}` rather than a concatenated buffer: IndexedDB stores structured
 * clones, so there is nothing to gain from packing it by hand and a real risk
 * of getting the offsets wrong.
 *
 * Both are plain `ArrayBuffer`s. A `Uint8Array` would round-trip through
 * IndexedDB just as happily, but it comes back typed `Uint8Array<ArrayBufferLike>`
 * -- which TypeScript will not accept as a `BufferSource`, because
 * `ArrayBufferLike` admits `SharedArrayBuffer`. Storing the buffer sidesteps a
 * cast at the one call site where a wrong type would mean a silent decrypt
 * failure rather than a compile error.
 */
interface Envelope {
  iv: ArrayBuffer;
  data: ArrayBuffer;
}

export async function getItemAsync(key: string): Promise<string | null> {
  const stored = await run<Envelope | undefined>(ITEMS, 'readonly', (s) => s.get(key));
  if (!stored) return null;

  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: stored.iv },
      await getKek(),
      stored.data
    );
    return new TextDecoder().decode(plain);
  } catch {
    /**
     * A value that will not decrypt is treated as absent, not as an error.
     *
     * It means the KEK changed under a value written by an older one -- a
     * cleared-then-restored IndexedDB, or a profile copied between browsers.
     * The callers above already handle "nothing stored": VaultContext's
     * `loadKeys` wipes and recreates when the device key has vanished
     * (`contexts/VaultContext.tsx`), which is precisely the right response
     * here too. Throwing instead would surface as a boot failure with no way
     * forward, which is the dead end the whole web seam exists to remove.
     */
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getKek(),
    new TextEncoder().encode(value)
  );
  await run(ITEMS, 'readwrite', (s) => s.put({ iv: iv.buffer, data } satisfies Envelope, key));
}

export async function deleteItemAsync(key: string): Promise<void> {
  await run(ITEMS, 'readwrite', (s) => s.delete(key));
}
