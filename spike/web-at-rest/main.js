import { column, Schema, Table } from '@powersync/common';
import { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS } from '@powersync/web';

// ---------------------------------------------------------------------------
// Canaries. Each one stands for a different class of data in the real app, so
// the scan result tells us *which layer* protects what rather than a single
// yes/no. Distinctive enough to grep for in raw bytes with no false positives.
// ---------------------------------------------------------------------------
const CANARY = {
  // Note body. In the real app this is AES-GCM encrypted by lib/crypto before
  // it is ever handed to SQLite, so it must NOT appear even in a plaintext db.
  noteBody: 'CANARY_NOTE_BODY_1a2b3c',
  // note_sync_base.body. The real app stores this as PLAINTEXT on purpose
  // (schema.ts says so explicitly) because SQLCipher covers the whole file.
  // On web with no whole-file encryption this is a genuine plaintext leak.
  syncBase: 'CANARY_SYNCBASE_BODY_4d5e6f',
  // Folder name. Encrypted at the app layer as of Stage 10.
  folderName: 'CANARY_FOLDER_NAME_7g8h9i',
  // Metadata the app deliberately leaves unencrypted: ids, timestamps.
  metadata: 'CANARY_NOTE_ID_META_0j1k2l'
};

const DB_PLAIN = 'spike-plain.db';
const DB_ENC = 'spike-encrypted.db';
// A stand-in for what lib/crypto/vault.ts getDatabaseKey() returns on native.
const DB_KEY = 'a3f1c9e07b2d48569af0c1e3b7d25984a3f1c9e07b2d48569af0c1e3b7d25984';

const AppSchema = new Schema({
  notes: new Table({
    title: column.text,
    body: column.text,
    created_at: column.text,
    is_trashed: column.integer
  }),
  // localOnly, plaintext body — mirrors the real note_sync_base exactly.
  note_sync_base: new Table(
    { note_id: column.text, body: column.text, updated_at: column.text },
    { localOnly: true }
  ),
  ui_state: new Table({ last_opened_note_id: column.text }, { localOnly: true })
});

const out = document.getElementById('out');
const log = (msg, cls = '') =>
  (out.innerHTML += `\n${cls ? `<span class="${cls}">${msg}</span>` : msg}`);

// --- app-layer field encryption (stands in for lib/crypto/noteCrypto.ts) ----
// Real AES-GCM via WebCrypto, so the ciphertext in the db is genuinely opaque.
async function fieldKey() {
  return crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, [
    'encrypt'
  ]);
}
async function encryptField(plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await fieldKey(),
    new TextEncoder().encode(plaintext)
  );
  return `enc:v1:${btoa(String.fromCharCode(...iv, ...new Uint8Array(ct)))}`;
}

async function openDb(filename, encryptionKey, vfs = WASQLiteVFS.IDBBatchAtomicVFS) {
  // v2 note: these options are FLAT on `database`. Passing them to
  // `new WASQLiteOpenFactory({...})` directly fails, because that constructor
  // reads them from an inner `open` property -- leaving dbFilename undefined
  // and throwing "Cannot read properties of undefined (reading 'length')".
  // PowerSyncDatabase builds the factory itself and supplies the logger.
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: {
      dbFilename: filename,
      vfs,
      encryptionKey,
      enableMultiTabs: false,
      // OPFS-based VFS *require* a worker; IndexedDB's does not.
      useWebWorker: vfs !== WASQLiteVFS.IDBBatchAtomicVFS
    }
  });
  await db.init();
  return db;
}

async function writeRows(filename, encryptionKey) {
  const label = encryptionKey ? 'ENCRYPTED' : 'PLAINTEXT';
  log(`\n=== Writing to ${filename} (${label}) ===`);
  const db = await openDb(filename, encryptionKey);

  // Exactly the pattern the real app uses: content encrypted at the app layer,
  // note_sync_base written as plaintext, metadata left clear.
  await db.execute('INSERT INTO notes(id, title, body, created_at, is_trashed) VALUES(?,?,?,?,?)', [
    CANARY.metadata,
    await encryptField(CANARY.folderName),
    await encryptField(CANARY.noteBody),
    '2026-08-21T10:00:00Z',
    0
  ]);
  await db.execute('INSERT INTO note_sync_base(id, note_id, body, updated_at) VALUES(?,?,?,?)', [
    'base-1',
    CANARY.metadata,
    CANARY.syncBase, // plaintext, deliberately
    '2026-08-21T10:00:00Z'
  ]);
  await db.execute('INSERT INTO ui_state(id, last_opened_note_id) VALUES(?,?)', [
    'ui-1',
    CANARY.metadata
  ]);

  const n = await db.get('SELECT count(*) AS c FROM notes');
  log(`  wrote notes=${n.c}, note_sync_base=1, ui_state=1`);
  // Close so everything is flushed to disk, mimicking "tab closed".
  await db.close();
  log('  db closed (flushed to storage)');
}

// --- raw storage scanning ---------------------------------------------------
function bytesContain(bytes, needle) {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Pull every byte out of an arbitrary IndexedDB value.
 *
 * The subtlety that broke the first version of this scan: IDBBatchAtomicVFS
 * stores each SQLite page as `{path, offset, version, data}` where `data` is a
 * **Uint8Array**, not an ArrayBuffer. Checking `instanceof ArrayBuffer` misses
 * it, and falling back to JSON.stringify turns the page into `{"0":83,...}` --
 * which contains none of the original text, so every canary reads as "not
 * found". That is a false negative in the safe-looking direction, which is the
 * worst kind for this spike, so this walks the structure properly instead.
 */
function collectDeep(v, chunks, depth = 0) {
  if (v == null || depth > 6) return;
  if (ArrayBuffer.isView(v)) {
    chunks.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  } else if (v instanceof ArrayBuffer) {
    chunks.push(new Uint8Array(v));
  } else if (typeof v === 'string') {
    chunks.push(new TextEncoder().encode(v));
  } else if (Array.isArray(v)) {
    for (const x of v) collectDeep(x, chunks, depth + 1);
  } else if (typeof v === 'object') {
    for (const x of Object.values(v)) collectDeep(x, chunks, depth + 1);
  }
}

/** Bytes for ONE IndexedDB database, so each db gets its own verdict. */
async function collectOneIdb(name) {
  const chunks = [];
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  for (const store of Array.from(db.objectStoreNames)) {
    const vals = await new Promise((res) => {
      const r = db.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res([]);
    });
    for (const v of vals) collectDeep(v, chunks);
  }
  db.close();
  return chunks;
}

async function collectOpfsBytes(dir, path = '') {
  const chunks = [];
  const names = [];
  for await (const [name, handle] of dir.entries()) {
    const p = `${path}/${name}`;
    if (handle.kind === 'file') {
      names.push(p);
      chunks.push(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    } else {
      const sub = await collectOpfsBytes(handle, p);
      chunks.push(...sub.chunks);
      names.push(...sub.names);
    }
  }
  return { chunks, names };
}

function verdict(label, chunks) {
  const total = chunks.reduce((a, b) => a + b.length, 0);
  log(`\n--- ${label} (${chunks.length} blobs, ${(total / 1024).toFixed(1)} KB) ---`);
  for (const [name, needle] of Object.entries(CANARY)) {
    const hit = chunks.some((c) => bytesContain(c, needle));
    log(
      `  ${hit ? 'READABLE IN THE CLEAR' : 'not readable         '}  <span class="k">${name}</span>`,
      hit ? 'leak' : 'safe'
    );
  }
}

async function scan() {
  log('\n============ Scanning raw browser storage ============');

  // Sanity check: the scanner must be able to find a canary that really IS
  // sitting in the clear. Without this, a broken scanner reports "all safe"
  // and we would draw exactly the wrong conclusion.
  const control = [new TextEncoder().encode(`x${CANARY.noteBody}x`)];
  const ok = control.some((c) => bytesContain(c, CANARY.noteBody));
  log(`scanner self-test (must be FOUND): ${ok ? 'PASS' : 'FAIL'}`, ok ? 'safe' : 'leak');

  const dbs = (await indexedDB.databases?.()) ?? [];
  log(`\nIndexedDB databases: ${dbs.map((d) => d.name).join(', ') || '(none)'}`);
  for (const { name } of dbs) {
    if (!name) continue;
    verdict(`IndexedDB: ${name}`, await collectOneIdb(name));
  }

  try {
    const opfs = await collectOpfsBytes(await navigator.storage.getDirectory());
    log(`\nOPFS files: ${opfs.names.join(', ') || '(none)'}`);
    if (opfs.chunks.length) verdict('OPFS (all files)', opfs.chunks);
  } catch (e) {
    log(`OPFS scan failed: ${e.message}`);
  }
}

/**
 * The control that makes the "unreadable" result mean something.
 *
 * An encrypted database that cannot be reopened proves nothing -- writing
 * random bytes would score identically on the canary scan. This reopens the
 * SAME file after a reload with the right key (must read back), and then with
 * a wrong key (must fail), which together show real encryption rather than
 * corruption.
 */
async function verifyReadback() {
  log('\n============ Reopening the encrypted db ============');

  const db = await openDb(DB_ENC, DB_KEY);
  const row = await db.get('SELECT body FROM note_sync_base WHERE note_id = ?', [CANARY.metadata]);
  const match = row?.body === CANARY.syncBase;
  log(`  correct key -> read back note_sync_base.body = "${row?.body}"`);
  log(`  matches what we wrote: ${match ? 'YES' : 'NO'}`, match ? 'safe' : 'leak');
  await db.close();

  try {
    const bad = await openDb(DB_ENC, DB_KEY.replace(/^a3/, 'ff'));
    await bad.get('SELECT count(*) AS c FROM note_sync_base');
    log('  wrong key   -> OPENED AND READ. Encryption is NOT effective.', 'leak');
    await bad.close();
  } catch (e) {
    log(`  wrong key   -> rejected: ${e.message.slice(0, 80)}`, 'safe');
  }
}

/** Answers "OPFS or IndexedDB?" by actually running the OPFS-backed VFS. */
async function opfsTest() {
  log('\n============ OPFS-backed VFS (OPFSCoopSyncVFS) ============');
  try {
    const db = await openDb('spike-opfs.db', undefined, WASQLiteVFS.OPFSCoopSyncVFS);
    await db.execute('INSERT INTO note_sync_base(id, note_id, body, updated_at) VALUES(?,?,?,?)', [
      'opfs-1',
      CANARY.metadata,
      CANARY.syncBase,
      '2026-08-21T10:00:00Z'
    ]);
    await db.close();
    log('  wrote 1 plaintext row via OPFS VFS');
  } catch (e) {
    log(`  OPFS VFS failed: ${e.message}`, 'leak');
  }
}

document.getElementById('verify').onclick = () =>
  verifyReadback().catch((e) => log(`ERROR: ${e.message}`, 'leak'));
document.getElementById('opfs').onclick = () =>
  opfsTest().catch((e) => log(`ERROR: ${e.message}`, 'leak'));

document.getElementById('plain').onclick = () =>
  writeRows(DB_PLAIN, undefined).catch((e) => log(`ERROR: ${e.message}`, 'leak'));
document.getElementById('enc').onclick = () =>
  writeRows(DB_ENC, DB_KEY).catch((e) => log(`ERROR: ${e.message}`, 'leak'));
document.getElementById('scan').onclick = () => scan().catch((e) => log(`ERROR: ${e.message}`, 'leak'));
/**
 * Can the browser hold the database key without the raw bytes hitting disk?
 *
 * WebCrypto can generate a key with extractable:false and hand back a
 * CryptoKey *handle*. structuredClone (which IndexedDB uses) can persist that
 * handle, so it survives a reload -- but exportKey() throws, and the raw bytes
 * are never exposed to JS. This checks all three properties for real, because
 * the whole web recommendation rests on this being true rather than folklore.
 */
async function keyStorageTest() {
  log('\n============ Non-extractable key in IndexedDB ============');
  const KEYDB = 'spike-keystore';
  const RAW_CANARY = 'CANARY_RAW_KEY_BYTES_m3n4o5';

  const store = async (mode, fn) =>
    new Promise(async (res, rej) => {
      const open = indexedDB.open(KEYDB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('keys');
      open.onsuccess = () => {
        const tx = open.result.transaction('keys', mode);
        const r = fn(tx.objectStore('keys'));
        r.onsuccess = () => {
          res(r.result);
          open.result.close();
        };
        r.onerror = () => rej(r.error);
      };
      open.onerror = () => rej(open.error);
    });

  // 1. Generate NON-extractable, persist the handle.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);
  await store('readwrite', (s) => s.put(key, 'dbkey'));
  // Also stash an extractable key holding a canary, as the counter-example.
  const bad = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(RAW_CANARY.padEnd(32, '!')),
    'AES-GCM',
    true,
    ['encrypt']
  );
  await store('readwrite', (s) => s.put(bad, 'extractable-key'));
  log('  stored one non-extractable and one extractable key');

  // 2. Read it back (simulates the next session) and prove it still works.
  const back = await store('readonly', (s) => s.get('dbkey'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    back,
    new TextEncoder().encode('hello')
  );
  const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, back, ct));
  log(`  reloaded handle still decrypts: ${pt === 'hello' ? 'YES' : 'NO'}`, pt === 'hello' ? 'safe' : 'leak');
  log(`  extractable flag on reloaded key: ${back.extractable}`);

  // 3. Prove the raw bytes cannot be recovered by script.
  try {
    await crypto.subtle.exportKey('raw', back);
    log('  exportKey() SUCCEEDED -- key is recoverable by any script', 'leak');
  } catch (e) {
    log(`  exportKey() refused: ${e.name}`, 'safe');
  }

  // 4. And that they are not sitting in IndexedDB in the clear.
  const chunks = await collectOneIdb(KEYDB);
  const leaked = chunks.some((c) => bytesContain(c, RAW_CANARY));
  log(
    `  raw key bytes of the EXTRACTABLE key found on disk: ${leaked ? 'YES' : 'no'}`,
    leaked ? 'leak' : 'safe'
  );
  log('    (the non-extractable one has no raw form to find)');
}

document.getElementById('keys').onclick = () =>
  keyStorageTest().catch((e) => log(`ERROR: ${e.message}`, 'leak'));

/**
 * The actual proposed architecture, end to end.
 *
 * The constraint that shapes it: `encryptionKey` is a STRING (it becomes
 * `PRAGMA key = '...'`), so a non-extractable CryptoKey cannot drive SQLite
 * directly -- there is no way to hand wa-sqlite a key handle. The key material
 * has to exist as a JS string at open time. So the non-extractable key can only
 * be a KEK: it wraps the db key at rest and unwraps it per session.
 *
 * On disk that leaves: the wrapped db key + a KEK handle whose bytes script
 * cannot read. Never the db key itself.
 */
async function architectureTest() {
  log('\n============ Proposed design: KEK-wrapped db key ============');
  const KEYDB = 'spike-arch';
  const DBNAME = 'spike-arch.db';
  const idb = async (mode, fn) =>
    new Promise((res, rej) => {
      const open = indexedDB.open(KEYDB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('v');
      open.onsuccess = () => {
        const tx = open.result.transaction('v', mode);
        const r = fn(tx.objectStore('v'));
        r.onsuccess = () => {
          res(r.result);
          open.result.close();
        };
        r.onerror = () => rej(r.error);
      };
      open.onerror = () => rej(open.error);
    });

  // --- first run: create the db key, wrap it, persist only the wrapped form.
  const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);
  const dbKeyHex = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, new TextEncoder().encode(dbKeyHex))
  );
  await idb('readwrite', (s) => s.put(kek, 'kek'));
  await idb('readwrite', (s) => s.put({ iv, wrapped }, 'wrappedDbKey'));
  log('  persisted: non-extractable KEK handle + wrapped db key');

  const db1 = await openDb(DBNAME, dbKeyHex);
  await db1.execute('INSERT INTO note_sync_base(id, note_id, body, updated_at) VALUES(?,?,?,?)', [
    'arch-1',
    CANARY.metadata,
    CANARY.syncBase,
    '2026-08-21T10:00:00Z'
  ]);
  await db1.close();

  // --- next session: unwrap with the KEK, reopen. No user interaction.
  const kek2 = await idb('readonly', (s) => s.get('kek'));
  const blob = await idb('readonly', (s) => s.get('wrappedDbKey'));
  const unwrapped = new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.iv }, kek2, blob.wrapped)
  );
  log(`  unwrapped db key matches: ${unwrapped === dbKeyHex ? 'YES' : 'NO'}`);
  const db2 = await openDb(DBNAME, unwrapped);
  const row = await db2.get('SELECT body FROM note_sync_base WHERE id = ?', ['arch-1']);
  await db2.close();
  log(`  reopened encrypted db with unwrapped key: "${row?.body}"`, 'safe');

  // The db key must not be recoverable from storage alone.
  const chunks = await collectOneIdb(KEYDB);
  const found = chunks.some((c) => bytesContain(c, dbKeyHex));
  log(`  db key recoverable from IndexedDB: ${found ? 'YES' : 'no'}`, found ? 'leak' : 'safe');
}

document.getElementById('arch').onclick = () =>
  architectureTest().catch((e) => log(`ERROR: ${e.message}`, 'leak'));

async function wipeAll() {
  for (const { name } of (await indexedDB.databases?.()) ?? []) {
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
  } catch {}
}

/**
 * `?auto=1` runs the whole sequence unattended, so the evidence can be
 * regenerated (and screenshotted headlessly) with one command instead of a
 * remembered click order.
 */
if (new URLSearchParams(location.search).has('auto')) {
  (async () => {
    out.innerHTML = 'Running full sequence...';
    await wipeAll();
    await writeRows(DB_PLAIN, undefined);
    await writeRows(DB_ENC, DB_KEY);
    await opfsTest();
    await scan();
    await verifyReadback();
    await keyStorageTest();
    await architectureTest();
    log('\n=== done ===');
    document.title = 'SPIKE_COMPLETE';
  })().catch((e) => log(`ERROR: ${e.message}`, 'leak'));
}

document.getElementById('wipe').onclick = async () => {
  for (const { name } of (await indexedDB.databases?.()) ?? []) indexedDB.deleteDatabase(name);
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
  } catch {}
  out.innerHTML = 'Wiped. Reload the page.';
};
