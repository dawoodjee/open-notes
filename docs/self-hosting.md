# Self-hosting

Run the backend yourself — Postgres, auth and sync — on a laptop or a server.
One `docker compose up`.

**Self-hosting does not change the encryption.** Note titles and bodies are
encrypted on the device before they are sent, so the database holds `enc:v1:`
envelopes either way and your server cannot read your notes. What changes is who
holds the metadata — accounts, timestamps, which notes exist — and who is
responsible for backups.

Two paths below. [Local](#local-trial) to try it in ten minutes;
[VPS](#deploy-to-a-vps) for something your phone can reach from anywhere. The
first four steps are shared.

---

## Docker in a minute

Skip if you know it.

- **Image** — a frozen filesystem with a program in it. A template; nothing runs.
- **Container** — a started image, isolated from your machine.
- **Volume** — a disk that outlives its container. **Deleting a volume deletes
  your notes.**
- **Compose** — a YAML file describing several containers, started together.

`docker compose up -d` starts everything in the background, `down` stops it and
keeps your data, `down -v` also destroys the volumes.

Install [Docker](https://docs.docker.com/get-started/get-docker/) — Compose v2
(`docker compose`, two words). **Give it at least 4 GB of memory**, or containers
get killed mid-start with exit code 137, which no log will explain.

---

## Setup

### 1. Get the code

```bash
git clone https://github.com/dawoodjee/open-notes.git && cd open-notes
```

### 2. Generate secrets

```bash
cp .env.example .env
```

```bash
node selfhost/generate-keys.mjs --write
```

`ANON_KEY` and `SERVICE_ROLE_KEY` are not passwords — they are JWTs signed by
`JWT_SECRET`, carrying the database role the caller acts as. They must be
generated together, and changing `JWT_SECRET` later invalidates both. The script
fills all six values into `.env` and never overwrites one already set.

### 3. Start it

```bash
cd selfhost && docker compose --env-file ../.env up -d
```

**Every compose command below runs from `selfhost/` and needs
`--env-file ../.env`** — Compose looks for `.env` beside the compose file, and
this one lives at the repo root. Forget it and you get
`required variable POSTGRES_PASSWORD is missing a value` rather than a
half-configured stack.

First run pulls a few GB. Then:

```bash
docker compose --env-file ../.env ps -a
```

Healthy looks like **nine services `running`** — eight `(healthy)`, with `rest`
showing a bare `Up` because the PostgREST image has no HTTP client to probe
itself with. `migrator` must show **`Exited (0)`**: it applies the schema and
stops, so a stopped migrator is success. Anything else there, read
`docker compose --env-file ../.env logs migrator`.

### 4. Prove it works

```bash
node scripts/verify-selfhost.mjs
```

Fifteen checks, plain Node, nothing to install. Signs up two accounts, writes a
note, and confirms the things that fail silently: the sign-in email carries a
code rather than a link, PowerSync accepts the token this stack issues, the note
lands in the right sync bucket as ciphertext, and a second account cannot see
it. Expect `15/15 passed`.

It leaves two junk accounts and a note behind — run it while setting up, not on
a stack holding real notes. Needs the bundled `mailpit` service.

---

## Local trial

Good for a simulator, or a phone on the same network.

Nothing more to configure: `API_EXTERNAL_URL` already defaults to
`http://127.0.0.1:8000`, and Kong and PowerSync listen on every interface so
another device on your LAN can reach them. If a real phone will connect, replace
`127.0.0.1` with your machine's LAN IP in `API_EXTERNAL_URL` and in the
`EXPO_PUBLIC_*` URLs — a phone cannot resolve your laptop's loopback.

Sign-in is a 6-digit emailed code, and out of the box nothing is sent: it is
caught by **Mailpit**, a fake inbox at <http://127.0.0.1:8025>. Request a code in
the app, open that page, read it.

Then build the app — [building.md](building.md).

---

## Deploy to a VPS

What the local path skips: a domain, TLS, real email, and not exposing Postgres
to the internet. Two small instances or one 2 GB box is enough; the stack idles
around 1.5 GB.

### 1. DNS

Point two names at the server:

```
api.notes.example.com   A   <server-ip>
sync.notes.example.com  A   <server-ip>
```

Two hostnames rather than one, because the app is configured with two
independent URLs and PowerSync serves from the root of its own origin.

### 2. Close the raw ports

In `.env`:

```
BIND_ADDR=127.0.0.1
```

This is the difference between a proxy and a decoration. Without it every
container port stays open on the public interface and anyone can bypass TLS by
talking to Kong directly on `:8000`. With it, nothing is reachable except
through the proxy.

### 3. Terminate TLS

```bash
sudo cp selfhost/Caddyfile /etc/caddy/Caddyfile
```

Edit the two hostnames, then `sudo systemctl reload caddy`. Caddy obtains and
renews Let's Encrypt certificates by itself — no flags, no cron. Both names must
already resolve to the server or the certificate request fails.

Note content is encrypted regardless, but **session tokens are not** — over
plain HTTP anyone on the path can take one and read the account's metadata.

### 4. Point everything at the domain

In `.env`:

```
API_EXTERNAL_URL=https://api.notes.example.com
EXPO_PUBLIC_SUPABASE_URL=https://api.notes.example.com
EXPO_PUBLIC_POWERSYNC_URL=https://sync.notes.example.com
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY you generated>
```

`API_EXTERNAL_URL` is what sign-in emails are built from — wrong value, links
that go nowhere. The `EXPO_PUBLIC_*` three are inlined into the app bundle at
build time, so changing them needs a rebuild, not a reload. That prefix means
"ships inside the app and is readable by anyone", which is fine for these (the
anon key is public by design; row-level security is what protects data) and must
never hold a secret.

### 5. Real email

Without working SMTP nobody can sign in, including you on a new device. Set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_ADMIN_EMAIL` to a
real provider, and delete the `mailpit` service from the compose file.

### 6. Lock it down

```bash
docker compose --env-file ../.env up -d
```

Then:

- **`DISABLE_SIGNUP=true`** once your own devices are enrolled, and restart.
  Otherwise a server on the open internet accepts new accounts.
- **Firewall to 22, 80 and 443.** With `BIND_ADDR` set nothing else listens
  publicly, but a firewall is the thing that stays correct when a future compose
  edit forgets.
- **`SERVICE_ROLE_KEY` bypasses row-level security entirely.** Server only.
- **Studio is not proxied**, on purpose — it has no authentication of its own.
  Reach it over SSH: `ssh -L 8001:127.0.0.1:8001 you@server`, then open
  <http://127.0.0.1:8001>.
- **Back up.** The volume is the only server-side copy:

  ```bash
  docker exec notes-selfhost-db-1 pg_dump -U supabase_admin postgres > backup.sql
  ```

  Devices keep their own encrypted copies, so a wipe is survivable while one
  still has the data — but do not rely on that.

### Google sign-in

Optional, and needs the real domain: Google will not accept an IP address as a
redirect URI. Create an OAuth client in Google Cloud Console with
`https://api.notes.example.com/auth/v1/callback` as the authorised redirect,
then set `GOOGLE_ENABLED=true`, `SUPABASE_AUTH_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_GOOGLE_SECRET`.

---

## What each service does

| Service | For |
|---|---|
| **db** | Postgres — but not stock Postgres. This image ships the schemas and the `anon` / `authenticated` / `service_role` roles the security policies refer to; stock Postgres applies the schema and then fails every policy. |
| **auth** | GoTrue. Signup, emailed codes, OAuth, and issuing the tokens everything else checks. |
| **rest** | PostgREST. Accounts, usernames, wrapped keys. **Notes do not go through here** — they go through PowerSync. |
| **kong** | The gateway. One port, routed by URL prefix, `apikey` header checked first. |
| **powersync** | Sync. Reads Postgres's write-ahead log and hands each device only the rows its token allows. Never sees plaintext. |
| **migrator** | Runs once, applies the schema, exits. Stopped is correct. |
| **templates** | Serves the sign-in email template to GoTrue. A whole container for one HTML file, because GoTrue fetches templates over HTTP and cannot read them off disk. |
| **studio** | Admin dashboard. Optional. |
| **meta** | Schema introspection for Studio. Optional, with it. |
| **mailpit** | Fake inbox. Delete it for real use. |

**Deliberately absent:** file storage and image proxying (nothing uploads
files), realtime (nothing subscribes), Logflare analytics and its log shipper,
and connection pooling. All are in Supabase's own compose file if you want them.
Logflare in particular is the most common reason a self-hosted Supabase will not
boot, and nothing here needs it.

---

## Three things that will trip you up

### 1. Two sync configs, one of them yours

```
powersync/sync-rules.yaml     <- self-hosted. Edit this one.
powersync/sync-streams.yaml   <- PowerSync Cloud only.
```

Both are real and committed; they are different formats for the same rules
(`bucket_definitions` versus Sync Streams edition 3). Editing the wrong one
changes nothing, with no error to say why.

### 2. A device can claim an account with the wrong key

**Symptom:** you sign into a second account on a device already used with
another, are never shown a recovery code, and later that account's notes arrive
elsewhere undecryptable.

**Cause:** one device has one data key, and it offers that key to each account it
signs into. An account with no key on record accepts it — even when the key
belongs to a different account.

**Why you cannot just edit it away:** `user_keys` allows `INSERT` and `SELECT`
and deliberately nothing else. A key that can be swapped in place is a key that
can silently orphan every note encrypted under the old one. Insert-only keeps
the failure recoverable.

**The fix**, out-of-band:

```bash
npx tsx scripts/repair-shared-account-keys.ts
```

Dry-run by default; `--apply` deletes the duplicate rows, keeping the oldest
claimant of each. Those accounts then run key setup on next sign-in and get a
real recovery code. It does **not** touch notes — anything encrypted under the
old key stays that way and the app flags it rather than overwriting, so it is
still readable if the original code turns up. Read the script header before
pointing it at anything you care about.

### 3. The database is the only server-side copy

`down -v` deletes the volume, and the volume is the notes. See the backup
command above.

---

## Troubleshooting

**Exit code 137.** Out of memory; the OS killed them and no log will say so.
Give Docker 4 GB. Running two Supabase stacks at once does this — stop the
`supabase` CLI if you use it for development.

**`port is already allocated`.** Change the port in `.env`
(`KONG_HTTP_PORT`, `POWERSYNC_HTTP_PORT`, `POSTGRES_HOST_PORT`, `STUDIO_PORT`,
`MAILPIT_PORT`) and update `API_EXTERNAL_URL` and the `EXPO_PUBLIC_*` URLs if
you moved Kong or PowerSync.

**`auth` or `rest` restart forever, "password authentication failed".** Role
passwords are set once, when the data volume is first created. If you changed
`POSTGRES_PASSWORD` afterwards, the database still has the old one. Restore the
old value, or `down -v` and start clean — which deletes the data.

**PowerSync is healthy but nothing syncs.** Almost always the replication
password. The schema creates that role with none on purpose, so no working
password is ever committed, and `selfhost/migrate.sh` sets it afterwards. If
that step did not run, PowerSync logs `28P01` and syncs nothing while every
container reports healthy:

```bash
docker compose --env-file ../.env logs powersync | grep -i "replication slot"
```

A working stack logs `Created replication slot`, then
`Activated new replication stream`.

**PowerSync warns `Supabase Auth is enabled, but no Supabase connection string
found`.** Expected on every start. It only means the service could not
auto-discover a key URL, which never works outside hosted Supabase; verification
uses the shared secret, configured explicitly.

**401 with a valid-looking key.** The gateway wants it in an `apikey` header,
not only `Authorization`:

```bash
curl -H "apikey: $ANON_KEY" https://api.notes.example.com/auth/v1/health
```

**The sign-in email is a link, not a 6-digit code.** The `templates` service is
unreachable, or `MAILER_AUTOCONFIRM` is `false`. Check
`docker compose --env-file ../.env logs auth | grep template` — a failed fetch
is logged, then GoTrue silently falls back to its own link template, so the
email is the only visible symptom.

**`429 over_email_send_rate_limit`.** GoTrue throttles email: roughly one per
address per 15 seconds plus an hourly cap. Testing sign-in repeatedly hits it.
Not a misconfiguration.

**`DEPRECATION NOTICE: GOTRUE_JWT_ADMIN_GROUP_NAME`.** Harmless, not set here.
The similar notice for `GOTRUE_JWT_DEFAULT_GROUP_NAME` should be ignored rather
than acted on — removing that variable empties `auth.users.role` and issues
tokens naming no Postgres role at all.

---

## How far this has been verified

Run against this compose file on an empty volume, using the same HTTP calls the
app makes.

**Infrastructure:** boots from empty; every service reaches healthy and
`migrator` exits 0; the schema applies and `user_keys` has exactly the SELECT and
INSERT policies above; PowerSync creates a replication slot and replicates
`public.notes`; Kong routes to GoTrue and PostgREST and rejects requests with no
`apikey`; re-running `up` does not re-apply migrations; `down -v` then `up`
reproduces all of it.

**The full round trip:** a sign-in request emails a real 6-digit code; the code
exchanges for a session with `role` and `aud` of `authenticated`; PowerSync
rejects an unauthenticated client and accepts the token this GoTrue issued; the
client gets a bucket scoped to its own user id; a note written by that user
replicates into it as an `enc:v1:` envelope; and a second signed-in account
cannot see that note over sync or over the REST API, nor can an anonymous
caller. That is what `scripts/verify-selfhost.mjs` re-runs.

**VPS mode:** with `BIND_ADDR=127.0.0.1` the whole stack boots and passes the
same fifteen checks, every published port binds to loopback only, and the LAN
interface refuses connections on Kong, PowerSync and Postgres. `selfhost/Caddyfile`
passes `caddy validate`.

**Not covered:** a physical device against a self-hosted stack, a real
certificate against a real domain (the DNS and ACME steps have not been executed
here), and Google sign-in. If you hit a wall, please open an issue.
