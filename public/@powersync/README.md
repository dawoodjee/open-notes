# PowerSync web worker assets

Generated, not hand-written. Regenerate after any `@powersync/web` upgrade:

    npm run powersync:assets

That runs the SDK's own `powersync-web copy-assets`, which drops the pre-bundled
database worker and its wasm here. **It clears this directory first**, so this
README is restored by hand afterwards — if it goes missing from a diff, that is
why.

`public/` is served at the site root by Expo's web dev server and by
`expo export --platform web`, so the worker is reachable at
`/@powersync/worker.js` — which is exactly what `lib/powersync/openDatabase.web.ts`
passes as its `worker` option.

## Why this is committed rather than ignored

A fresh clone has to be able to build web without anyone remembering a setup step.
An install hook would do the same job, but it fails silently in environments that
gate install scripts — and the failure mode is a web app that boots to a blank
screen for reasons nothing on disk explains.

## Which wasm survives, and why it changed in Stage 13a

`copy-assets` emits four wasm builds totalling 7.4 MB. Three are deleted after
every regeneration, leaving exactly one: **`assets/mc-wa-sqlite-*.wasm` (1.31 MB)**.

| Deleted | Wanted by |
|---|---|
| `wa-sqlite-*.wasm` | the plain build — no encryption support |
| `*-async-*.wasm` (both plain and `mc-`) | `IDBBatchAtomicVFS`, the only VFS on the async factory |

**This is the reverse of what it used to be**, and the swap is the whole point.
Until 13a the build opened `InMemoryVfs` with no encryption key, so the plain
synchronous build was the right one to keep and the `mc-` builds were dead
weight. `mc-` is the **SQLite3MultipleCiphers** build — it is the only wasm here
that can decrypt anything. Now that the database is encrypted (Adam's call,
2026-08-25: mandatory), keeping the old prune would have silently removed the
only file capable of opening it.

`OPFSCoopSyncVFS` is what makes one file enough. Only `IDBBatchAtomicVFS` uses
the async factory, so choosing OPFS costs 1.31 MB where IndexedDB would cost
2.50 MB — see `lib/powersync/openDatabase.web.ts` for the rest of that reasoning.
Net change to this directory: **≈ +0.2 MB**.

If a later stage switches VFS again, rerun the script and keep the wasm that VFS
actually loads, or it will 404 at open time.

The `.js.map` files are deleted for the same reason as before: they are five
times the size of the code they annotate, and they debug the SDK's worker, not
this app.
