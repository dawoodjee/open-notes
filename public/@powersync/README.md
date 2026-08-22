# PowerSync web worker assets

Generated, not hand-written. Regenerate after any `@powersync/web` upgrade:

    npm run powersync:assets

That runs the SDK's own `powersync-web copy-assets`, which drops the pre-bundled
database worker and its wasm here. `public/` is served at the site root by Expo's
web dev server and by `expo export --platform web`, so the worker is reachable at
`/@powersync/worker.js` — which is exactly what `lib/powersync/openDatabase.web.ts`
passes as its `worker` option.

## Why this is committed rather than ignored

A fresh clone has to be able to build web without anyone remembering a setup step.
An install hook would do the same job, but it fails silently in environments that
gate install scripts — and the failure mode is a web app that boots to a blank
screen for reasons nothing on disk explains.

## Two deliberate deletions

`copy-assets` emits four wasm builds totalling 7.4 MB. Three are deleted after
every regeneration, leaving `assets/wa-sqlite-*.wasm` (1.1 MB):

| Deleted | Wanted by |
|---|---|
| `wa-sqlite-async-*.wasm` | the async VFSs — `IDBBatchAtomicVFS`, OPFS |
| `mc-wa-sqlite*.wasm` | the multiple-ciphers builds, used only when an `encryptionKey` is set |

We open `InMemoryVfs` with no encryption key, which resolves to the plain
synchronous build and never asks for the others. If a later stage switches VFS —
Stage 13's at-rest work is the obvious candidate — rerun the script and keep the
wasm that VFS actually loads, or it will 404 at open time.

The `.js.map` files are deleted for the same reason: they are five times the size
of the code they annotate, and they debug the SDK's worker, not this app.
