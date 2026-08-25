# web-at-rest spike

Throwaway. Not part of the app, not wired into the Expo build, its own
`package.json` so nothing here touches the main dependency tree.

Answers one question: **what is actually readable in browser storage after
`@powersync/web` writes notes to disk?** Findings and the recommendation live in
[`docs/web-at-rest-findings.md`](../../docs/web-at-rest-findings.md).

## Run it

```bash
npm install
npx vite
```

Then open http://localhost:5173 and click the buttons in order, or run the whole
sequence unattended and capture the evidence:

```bash
node capture.mjs
```

That writes `evidence/at-rest-scan.png` and `.txt`. It drives a real Chrome and
waits for the page to signal completion via `document.title`; Chrome's plain
`--screenshot` flag fires before the WASM finishes and captures an empty page.

`?auto=1` on the URL runs the same sequence in a normal browser.

## What it does

1. Writes the same row shape the real app uses — note body and folder name
   AES-GCM encrypted at the app layer, `note_sync_base.body` in plaintext (as
   the real schema does), ids and timestamps clear — into an **unencrypted**
   PowerSync database.
2. Writes the identical data into an **encrypted** one (`encryptionKey` set).
3. Repeats via the OPFS-backed VFS, since the storage bucket differs.
4. Dumps raw bytes out of every IndexedDB database and OPFS file, and searches
   for each canary string.
5. Reopens the encrypted db with the right key (must read back) and a wrong key
   (must fail) — without this, "unreadable" would be indistinguishable from
   having written garbage.
6. Proves the non-extractable-CryptoKey KEK design: wrap the db key, persist
   only the wrapped form, unwrap next session, reopen.

The scan self-tests first: it asserts it *can* find a canary that really is in
the clear. An earlier version reported "all safe" for the plaintext database
because IndexedDB stores SQLite pages as `Uint8Array` and the check fell through
to `JSON.stringify` — a false negative in the reassuring direction.
