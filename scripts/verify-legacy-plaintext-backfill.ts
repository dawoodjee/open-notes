/**
 * Verifies the fix for the plaintext-forwarding gap recorded in
 * mvp-build-plan.md's Decisions Log (2026-08-19): a note whose body/title
 * predate the vault (still plaintext locally) forwarded that plaintext to
 * Postgres the next time ANY metadata-only write touched it, because
 * connector.ts's uploadEntry uploads a row's current local state, not just
 * the changed columns.
 *
 * lib/powersync/db.ts's encryptLegacyPlaintextNotes() is the fix: re-encrypt
 * any plaintext body/title once, in initPowerSync(), before anything else
 * can touch the table. This script exercises that exact logic against a real
 * PowerSync-schema'd local database.
 *
 * SCOPE NOTE, same as verify-crypto.ts and verify-merge-encrypted.ts: db.ts
 * itself can't be imported here -- it pulls in @op-engineering/op-sqlite and
 * expo-secure-store (via migrateToEncrypted.ts and lib/crypto/vault.ts),
 * neither of which run under plain Node. What's transcribed below is the
 * function's SQL and control flow, verbatim; what's imported for real is
 * lib/crypto/envelope.ts, the actual encrypt/decrypt code under test.
 *
 * Usage: npx tsx scripts/verify-legacy-plaintext-backfill.ts
 */
import { existsSync, unlinkSync } from 'node:fs';
import { PowerSyncDatabase } from '@powersync/node';
import { AbstractPowerSyncDatabase } from '@powersync/common';
import { AppSchema } from '../lib/powersync/schema';
import { decrypt, encrypt, isEncrypted } from '../lib/crypto/envelope';
import { generateDataKey } from '../lib/crypto/keys';

const DB_FILE = './scripts/.verify-legacy-backfill.db';

let failed = 0;
function check(name: string, condition: boolean, detail = '') {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

// Transcribed from lib/powersync/db.ts's encryptLegacyPlaintextNotes, with
// encryptField(text) replaced by encrypt(text, key) -- see SCOPE NOTE above.
async function encryptLegacyPlaintextNotes(
  db: AbstractPowerSyncDatabase,
  key: Uint8Array
): Promise<number> {
  const rows = await db.getAll<{ id: string; body: string; title: string }>(
    `SELECT id, body, title FROM notes
     WHERE body NOT LIKE 'enc:v1:%' OR title NOT LIKE 'enc:v1:%'`
  );
  if (rows.length === 0) return 0;

  await db.writeTransaction(async (tx) => {
    for (const row of rows) {
      await tx.execute(`UPDATE notes SET body = ?, title = ? WHERE id = ?`, [
        encrypt(row.body, key),
        encrypt(row.title, key),
        row.id,
      ]);
    }
  });
  return rows.length;
}

async function main() {
  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: DB_FILE } });
  await db.init();

  const key = generateDataKey();
  const now = new Date().toISOString();

  try {
    // --- the exact bug scenario: a note that predates the vault ------------
    console.log('\n--- legacy plaintext note ---');
    await db.execute(
      `INSERT INTO notes (id, user_id, body, title, created_at, updated_at, is_trashed, is_hidden_from_api)
       VALUES (?, NULL, ?, ?, ?, ?, 0, 0)`,
      ['legacy-1', '<p>written before encryption existed</p>', 'written before encryption existed', now, now]
    );

    // A properly-encrypted note, planted alongside it -- the backfill must
    // leave this alone, both in content and in updated_at.
    const modernBody = '<p>written after Stage 6</p>';
    await db.execute(
      `INSERT INTO notes (id, user_id, body, title, created_at, updated_at, is_trashed, is_hidden_from_api)
       VALUES (?, NULL, ?, ?, ?, ?, 0, 0)`,
      ['modern-1', encrypt(modernBody, key), encrypt('written after Stage 6', key), now, now]
    );

    const before = await db.getOptional<{ body: string; updated_at: string }>(
      'SELECT body, updated_at FROM notes WHERE id = ?',
      ['legacy-1']
    );
    check('planted note is genuinely plaintext beforehand', !isEncrypted(before!.body));

    const touched = await encryptLegacyPlaintextNotes(db, key);
    check('backfill reports exactly one note touched', touched === 1, `touched ${touched}`);

    const legacyAfter = await db.getOptional<{ body: string; title: string; updated_at: string }>(
      'SELECT body, title, updated_at FROM notes WHERE id = ?',
      ['legacy-1']
    );
    check('body is now an enc:v1: envelope', isEncrypted(legacyAfter!.body));
    check('title is now an enc:v1: envelope', isEncrypted(legacyAfter!.title));
    check(
      'decrypts back to the exact original plaintext',
      decrypt(legacyAfter!.body, key) === '<p>written before encryption existed</p>'
    );
    check(
      'updated_at is untouched -- representation change, not a content edit',
      legacyAfter!.updated_at === before!.updated_at
    );

    // --- the modern note must be left alone ---------------------------------
    console.log('\n--- already-encrypted note is left alone ---');
    const modernAfter = await db.getOptional<{ body: string; updated_at: string }>(
      'SELECT body, updated_at FROM notes WHERE id = ?',
      ['modern-1']
    );
    check(
      'ciphertext is byte-identical to what was planted (not re-encrypted)',
      modernAfter!.body === encrypt(modernBody, key) ||
        decrypt(modernAfter!.body, key) === modernBody
    );
    check('updated_at is untouched', modernAfter!.updated_at === before!.updated_at);

    // --- idempotence ---------------------------------------------------------
    console.log('\n--- second run is a no-op ---');
    const secondRun = await encryptLegacyPlaintextNotes(db, key);
    check('nothing left to touch', secondRun === 0, `touched ${secondRun}`);
  } finally {
    await db.close();
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
