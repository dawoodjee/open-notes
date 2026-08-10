import { decrypt, encrypt, isEncrypted } from './envelope';
import { getDataKey, isUnlocked } from './vault';

/**
 * The boundary where note content becomes ciphertext and back.
 *
 * WHY THE BOUNDARY IS HERE AND NOT IN THE CONNECTOR:
 * The obvious design is "encrypt on upload, decrypt on download" inside
 * lib/powersync/connector.ts. It cannot work. PowerSyncBackendConnector has
 * only fetchCredentials() and uploadData() -- there is no download hook, and
 * rows arriving from the sync stream are written straight into SQLite by the
 * SDK. Ciphertext lands in the local `notes` table no matter what we do.
 *
 * So the local columns hold ciphertext, byte-identical to Postgres, and
 * decryption happens where rows are read into app objects. That turns out to
 * be one function (mapRowToNote), because the codebase already funnelled
 * every read through it.
 *
 * A useful consequence: search in components/NoteListPane.tsx already filters
 * in JavaScript over the mapped Note objects rather than with a SQL LIKE, so
 * it keeps working on plaintext automatically and never touches the server.
 */

// Decryption is memoised because PowerSync's watch() re-emits the whole notes
// table on every change. Without this, editing one note would re-decrypt every
// note on every keystroke. Keyed by ciphertext, which is safe: a fresh random
// nonce per encryption means a given ciphertext string maps to exactly one
// plaintext, forever.
const cache = new Map<string, string>();
const CACHE_LIMIT = 500;

function remember(ciphertext: string, plaintext: string): string {
  if (cache.size >= CACHE_LIMIT) {
    // Cheap bounded eviction: drop the oldest insertion. Map preserves
    // insertion order, so this is FIFO rather than true LRU -- adequate for
    // a cache that only exists to avoid redundant work.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(ciphertext, plaintext);
  return plaintext;
}

export function encryptField(plaintext: string): string {
  return encrypt(plaintext, getDataKey());
}

export interface DecryptResult {
  ok: boolean;
  text: string;
}

/**
 * Never throws. Callers get an explicit ok flag instead, because the two
 * failure modes need different handling and neither should crash a render:
 *
 *   - the vault is locked (possible during teardown, or a stray read before
 *     unlock), or
 *   - the value was encrypted under a different data key -- which is exactly
 *     what a second device sees today, before Phase 3 teaches it to adopt the
 *     account's key.
 */
export function tryDecryptField(value: string | null | undefined): DecryptResult {
  const raw = value ?? '';
  if (raw === '') return { ok: true, text: '' };

  // Pre-Stage-6 plaintext, still in Postgres for older rows. Passed through
  // untouched and re-encrypted the next time the note is saved.
  if (!isEncrypted(raw)) return { ok: true, text: raw };

  const cached = cache.get(raw);
  if (cached !== undefined) return { ok: true, text: cached };

  if (!isUnlocked()) return { ok: false, text: '' };

  try {
    return { ok: true, text: remember(raw, decrypt(raw, getDataKey())) };
  } catch {
    return { ok: false, text: '' };
  }
}

/** Drops cached plaintext. Called on sign-out and account switch, so one
 *  account's decrypted content can't be served to the next. */
export function clearNoteCryptoCache(): void {
  cache.clear();
}
