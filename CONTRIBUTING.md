# Contributing

Pull requests are welcome. This is a small project, so there is no process to
speak of — but a few things are specific enough to be worth writing down.

## Getting set up

1. Run a backend: [docs/self-hosting.md](docs/self-hosting.md).
2. Build the app: [docs/building.md](docs/building.md). Note that `ios/` and
   `android/` are generated, so `npx expo prebuild` is a required step and Expo
   Go will not work.

If you get stuck following either of those, that is a bug in the docs and worth
an issue on its own.

## Branches

One branch per feature or fix, off `main`. Nothing is committed to `main`
directly. Name it after what it does — `fix-android-back-gesture`,
`docs/self-hosting` — and keep it to one thing, so it can be reverted alone.

## Before opening a PR

Type-check:

```bash
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

Then run the checks that apply to what you touched. They are plain Node scripts
that exercise the real modules, not a test framework.

**Safe anywhere — no server, no database:**

```bash
npx tsx scripts/verify-crypto.ts
```

```bash
npx tsx scripts/verify-plaintext-gates.ts
```

```bash
npx tsx scripts/verify-auth-serialization.ts
```

Run `verify-crypto` for any change under `lib/crypto/`, and
`verify-plaintext-gates` for any change under `lib/plaintext/` — the latter
asserts that nothing in that directory imports Supabase, which is the property
keeping plaintext off the sync path.

**Need a running local stack, and write to it:** `verify-sync.ts`,
`verify-merge-encrypted.ts`, `verify-merge-two-devices.ts`,
`verify-oauth-errors.ts`. These create rows and delete the specific rows they
created. Point them at a throwaway database, never one with notes you want.

**Destructive — read this before running it:**

```
scripts/verify-key-distribution.ts
```

It begins by running `delete from public.user_keys` — **every row, not its
own** — and deleting every encrypted note in the database. That is deliberate
test setup for the key-distribution scenario, and it will take your notes with
it if you run it against a stack you actually use. The `seed-*.ts` scripts
mutate state similarly.

There is no CI running any of this, so whatever you run locally is the whole
check.

## What makes a PR easy to review here

- **One change per PR.** Two unrelated fixes in one branch is the main reason
  something sits unreviewed.
- **Say what you observed, not just what you changed.** "Verified on a Pixel 6a
  emulator, hardware back returns to the list and the note is saved" is worth
  more than a description of the diff, which is already visible.
- **Match the surrounding comment style.** This codebase explains *why* in
  comments — particularly where the obvious approach was tried and rejected.
  Comments that restate the code are noise; comments that record a constraint
  save the next person a day.
- **Flag anything touching encryption, sync, or auth explicitly.** Those three
  have properties that are easy to break invisibly: plaintext must never reach
  the sync path, RLS rejections must retry rather than drop, and the key must
  never transit the server unwrapped. Say which one you are near and how you
  checked.
- **If you changed the schema**, say whether it needs a migration and whether it
  affects `powersync/sync-rules.yaml`. That file is the self-hosted sync config;
  `sync-streams.yaml` is the hosted one, and both need to stay in step.

## Reporting bugs

Include the platform and whether you are self-hosting. For sync problems,
`docker compose logs powersync` is usually the fastest thing to attach.
