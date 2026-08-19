# Two stacks: dev and live

The app talks to one of two completely separate backends, chosen at build time.

| | **Dev** | **Live** |
|---|---|---|
| Supabase | local Docker, `http://127.0.0.1:54321` | Supabase Cloud, `https://svbrvtnldkjwtnppsugi.supabase.co` |
| PowerSync | local Docker, `http://127.0.0.1:8080` | PowerSync Cloud, `https://6a78d51353f73afec8a84403.powersync.journeyapps.com` |
| Config lives in | `.env` (gitignored) | `eas.json` → `build.live.env` (committed) |
| Sync config | `powersync/sync-rules.yaml` | `powersync/sync-streams.yaml` |
| Used by | simulators, `scripts/verify-*.ts` | the iPad and the Android phone |
| Safe to wipe? | yes, that's the point | never |

The split exists so that `supabase db reset` can never reach real notes. It
also removed three constraints that pointing the devices at this Mac would have
forced: a LAN IP baked into every build (which breaks the moment tethering
changes it), HTTPS enforcement disabled on both platforms to allow cleartext,
and no Google sign-in, because Google will not accept a private IP as an OAuth
redirect URI.

## Building for each

**Dev** is the default and nothing about it changed:

```bash
npm start          # simulators, reads .env
npm run ios        # local Release/Debug against 127.0.0.1
```

**Live** is always explicit:

```bash
npm run ios:live -- <device-udid>              # iPad, over USB
eas build --platform android --profile live    # APK
```

`scripts/ios-live.sh` reads its values back out of `eas.json`'s `live` profile
rather than keeping its own copy. Two hand-maintained lists of server addresses
is how an iPad and a phone end up quietly syncing against different backends.

Deliberately *not* a `.env.production` file: Expo's docs warn against switching
environments on `NODE_ENV`, because `expo export` forces `NODE_ENV=production`
regardless of intent. Variables exported into the process beat `.env` under
standard dotenv resolution, which is both simpler and harder to get wrong.

## Things that will bite you

**The iPad app stops working after 7 days.** The Apple Developer account is a
free personal team, so signatures expire in a week and the app refuses to
launch. Re-run `npm run ios:live` over USB to re-sign. Only the paid program
($99/yr) fixes this properly — it would also unlock EAS over-the-air
distribution for iOS, which the free team cannot use at all. The Android APK
has no such limit.

**A free PowerSync instance deactivates after ~1 week idle.** Daily use avoids
it; a holiday doesn't. Reactivate from the dashboard.

**The live and dev sync configs are in different formats, and both are real.**
PowerSync Cloud is on Sync Streams edition 3 (`sync-streams.yaml`); the
self-hosted dev service still uses `bucket_definitions` (`sync-rules.yaml`).
`request.user_id()` became `auth.user_id()`, and the `parameters:`/`data:` split
collapsed into one `query:`. Keep them in step by hand.

`auto_subscribe: true` is required in the streams config. Sync Streams normally
wait for the client to subscribe, and `@powersync/common` 2.0.0 predates that
API — it has no subscribe call to make, so a non-auto stream would sync nothing
and look like a connection problem.

**A schema change has to be applied twice.** Locally via `supabase db reset` or
`supabase migration up`; to live via `supabase db push`. The push is a separate,
deliberate act.

**`powersync_role` loses its password on every local reset.** The migration
creates it with `password null` on purpose (a real password in a committed
migration gets copied past its local-dev context). PowerSync then fails with
`28P01 password authentication failed for user "powersync_role"` and replicates
nothing, while every container still reports healthy.
`scripts/reset-local-db.sh` re-applies it from `.env`.

**`postgres` is not the superuser in a Supabase stack.** `supabase_admin` is,
and `auth.users` is owned by `supabase_auth_admin`. Anything touching auth
tables — including the restore's `ALTER TABLE ... DISABLE TRIGGER ALL` — has to
connect as `supabase_admin` or it fails with `must be owner of table users`.

**Compose names a project after its directory.** `docker-compose.yml` pins
`name: notes` for this reason. Without it, running `docker compose` from a git
worktree addresses a different, empty project: `restart powersync` prints
nothing, exits 0, and restarts nothing.

**CocoaPods needs a UTF-8 locale.** Without `LANG`, `pod install` dies with
`Unicode Normalization not appropriate for ASCII-8BIT`, which reads like a Ruby
bug. `scripts/ios-live.sh` sets it.

## Resetting the local database safely

```bash
scripts/reset-local-db.sh
```

Backs up `auth.users`, `auth.identities`, `public.profiles` and `public.notes`,
runs `supabase db reset`, restores them, re-arms `powersync_role`, and restarts
PowerSync. Dumps land in `supabase/backups/` (gitignored — real rows). Restore
an older one with `scripts/restore-local-data.sh <file>`.

Sessions are deliberately not preserved; sign in again after a reset.

## Live project admin

- Supabase project ref `svbrvtnldkjwtnppsugi`, region `eu-central-1`.
- The anon key in `eas.json` is public by design — RLS is the security
  boundary, and the migration grants table privileges to `authenticated` only,
  never to `anon`.
- **Signups are open on live, deliberately.** `disable_signup` is `false`.
  An earlier version of this file said they "should stay disabled", which was
  never true of the running project — the setting lives only in the Supabase
  dashboard, so nothing in the repo ever contradicted it and the claim went
  unchallenged. Public signup is the intent; RLS is what keeps a new account
  from seeing anyone else's rows. Verify the live state rather than trusting
  this line:

  ```bash
  curl -s "https://svbrvtnldkjwtnppsugi.supabase.co/auth/v1/settings" \
    -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" | jq '{disable_signup, external}'
  ```

  That the policy has no repo-level expression is the real gap here. The
  self-hosted stack states it as `DISABLE_SIGNUP` in `.env.example`; the
  hosted project has no equivalent, which is exactly how this drifted.
- **Google sign-in is enabled on live** (`external.google` is `true` from the
  same endpoint). This file previously said it "is not wired up"; that is out
  of date. It has not been exercised by a regression pass, so treat it as
  enabled-but-unverified rather than known-good.
