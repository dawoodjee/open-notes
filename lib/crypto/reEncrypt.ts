import { getPowerSync } from '@/lib/powersync/db';
import { decrypt, encrypt, isEncrypted } from './envelope';
import { clearNoteCryptoCache } from './noteCrypto';

/**
 * Re-encrypt every local note from one data key to another.
 *
 * Needed exactly once per device, when it signs into an account whose notes
 * are encrypted under a different key than the one this device generated at
 * PIN setup. The notes sitting here locally -- written before sign-in, and
 * just claimed by the account -- are under the OLD key; everything arriving
 * from the server is under the NEW one. Without this pass the device would
 * hold two mutually unreadable halves.
 *
 * Runs BEFORE connectPowerSync(), for the same reason claimUnownedNotes does:
 * once sync is live these rows start uploading, and uploading a note still
 * encrypted under the old key would publish content the account cannot read.
 *
 * Deliberately writes through raw SQL rather than updateNoteInDB(): that
 * function encrypts with the CURRENT key and refuses to overwrite anything it
 * can't decrypt, both of which are exactly wrong here. It also must not touch
 * updated_at -- this is a change of representation, not an edit, and bumping
 * the timestamp would make every note look newly modified to every other
 * device.
 */
export async function reEncryptLocalNotes(
  oldKey: Uint8Array,
  newKey: Uint8Array
): Promise<{ converted: number; skipped: number }> {
  const rows = await getPowerSync().getAll<{ id: string; body: string; title: string }>(
    'SELECT id, body, title FROM notes'
  );

  let converted = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      // Pre-Stage-6 plaintext passes through untouched by decrypt(), so this
      // also upgrades any legacy rows to the new key in the same pass.
      const body = isEncrypted(row.body ?? '') ? decrypt(row.body, oldKey) : (row.body ?? '');
      const title = isEncrypted(row.title ?? '') ? decrypt(row.title, oldKey) : (row.title ?? '');

      await getPowerSync().execute('UPDATE notes SET body = ?, title = ? WHERE id = ?', [
        encrypt(body, newKey),
        encrypt(title, newKey),
        row.id,
      ]);
      converted++;
    } catch {
      // Already under the new key, or under neither. Skipped rather than
      // destroyed -- a note we cannot read is not a note we should rewrite.
      skipped++;
    }
  }

  // The cache is keyed by ciphertext, and every ciphertext just changed.
  clearNoteCryptoCache();

  return { converted, skipped };
}
