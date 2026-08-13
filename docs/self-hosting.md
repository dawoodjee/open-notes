# Self-hosting

Run the backend yourself: Postgres, auth, and sync, on your own machine or your
own server. One `docker compose up`.

**Self-hosting does not weaken the encryption, and it does not strengthen it
either — there is nothing left to strengthen.** Note titles and bodies are
encrypted on the device before they are ever sent, so the database stores
`enc:v1:` envelopes and nothing else. Your server cannot read your notes any
more than anyone else's can. What self-hosting changes is who holds the
metadata — account rows, timestamps, which notes exist — and who is responsible
for backups.

---

## If you have never used Docker

Four words to know, and then you can skip to the next section.

- **Image** — a frozen, read-only filesystem with a program in it. `postgres` is
  an image. Nothing runs; it is a template.
- **Container** — an image that has been started. Isolated from your machine
  except where you explicitly connect it.
- **Volume** — a disk that outlives its container. Containers are disposable;
  volumes are where the data actually lives. **Deleting a volume deletes your
  notes.**
- **Compose** — a YAML file describing several containers and how they connect,
  so you start them together instead of one by one.

Two commands do almost everything:

```bash
docker compose up -d
```

```bash
docker compose down
```

`up -d` starts everything in the background; `down` stops it. `down` keeps your
data. `down -v` also deletes the volumes, which deletes your notes.

Install [Docker Desktop](https://docs.docker.com/get-started/get-docker/), or
Docker Engine on Linux. Everything here needs Docker Compose v2 (`docker
compose`, two words — not the older `docker-compose`).

**Give Docker at least 4 GB of memory.** Docker Desktop's default is often
lower, and this stack will be killed partway through starting if it is — you
will see containers exit with code 137, which is the operating system killing
them, not a bug in the stack. Docker Desktop → Settings → Resources.

---

## Setup

### 1. Get the code

```bash
git clone https://github.com/dawoodjee/open-notes.git
```

```bash
cd open-notes
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Now generate the secrets. They are not free-form passwords: `ANON_KEY` and
`SERVICE_ROLE_KEY` are JSON Web Tokens signed by `JWT_SECRET`, carrying the
database role the caller acts as. They have to be generated together, and
changing `JWT_SECRET` later invalidates both.

```bash
node selfhost/generate-keys.mjs --write
```

That fills the six generated values straight into `.env` and tells you which
ones it set. It never overwrites a value that is already there, so it is safe to
re-run. Drop `--write` if you would rather see them and paste them yourself.
(Needs Node 18+, which you will want anyway for building the app.)

Then set one address by hand:

```
API_EXTERNAL_URL=http://127.0.0.1:8000
```

This is the URL clients reach the API on **from outside Docker**. `127.0.0.1`
is right if you are only using a simulator on the same machine. If a real phone
will connect, it must be an address that phone can resolve — your machine's LAN
IP, or a domain name. Getting this wrong produces sign-in emails whose links go
nowhere.

Everything else in `.env` has a working default.

### 3. Start it

```bash
cd selfhost && docker compose --env-file ../.env up -d
```

**Every `docker compose` command below is run from `selfhost/`, and every one
needs `--env-file ../.env`.** Compose looks for a `.env` beside the compose
file, and this project's lives at the repo root. Forget the flag and it stops
with `required variable POSTGRES_PASSWORD is missing a value` rather than
starting something half-configured.

First run pulls several GB of images and takes a few minutes. After that it is
seconds.

Check it came up:

```bash
docker compose --env-file ../.env ps -a
```

Eight services should be `running` and one — `migrator` — should be
`exited (0)`. That one is supposed to exit; it applies the database schema and
stops. If it exited with anything other than 0, read
`docker compose logs migrator`.

### 4. Point the app at it

Back in `.env`, the app's three variables:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8000
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY you generated>
EXPO_PUBLIC_POWERSYNC_URL=http://127.0.0.1:8080
```

`EXPO_PUBLIC_` is not decoration — Expo inlines those values into the app bundle
at build time, so they ship inside the app and anyone can read them out. That is
fine for these three (the anon key is public by design; row-level security is
what protects data). Never put a secret behind that prefix.

These are baked in at build time, so changing them needs a rebuild, not a
reload. Then follow [building.md](building.md).

### 5. Sign in once

Sign-in is a 6-digit code sent by email. Out of the box the stack does not send
email — it catches it in **Mailpit**, a fake inbox at
<http://127.0.0.1:8025>. Request a code in the app, open that page, read the
code.

That is for trying the stack out. For real use, set `SMTP_*` in `.env` to a real
provider and delete the `mailpit` service from the compose file. Without working
email, nobody can sign in — including you, on a new device.

Once your own devices are enrolled, set `DISABLE_SIGNUP=true` and restart, so a
server on the open internet is not accepting new accounts.

---

## What each service does

| Service | What it is for |
|---|---|
| **db** | Postgres. Not stock Postgres — this image ships the schemas and the `anon` / `authenticated` / `service_role` roles that the security policies refer to. Stock Postgres applies the schema and then fails every policy. |
| **auth** | GoTrue. Signup, emailed sign-in codes, OAuth, and issuing the tokens everything else checks. Creates its own `auth` schema at startup. |
| **rest** | PostgREST. Exposes the tables as a REST API — accounts, usernames, wrapped keys. **Notes do not go through here**; they go through PowerSync. |
| **kong** | The gateway. One public port, routed to `auth` or `rest` by URL prefix, with the `apikey` header checked first. |
| **powersync** | The sync service. Reads Postgres's write-ahead log and hands each device the rows its token entitles it to. Never sees plaintext. |
| **migrator** | Runs once, applies the schema, exits. Not a bug when you see it stopped. |
| **studio** | The web admin UI at <http://127.0.0.1:8001>. Optional — nothing depends on it. |
| **meta** | Schema introspection, so Studio can list tables. Optional, with Studio. |
| **mailpit** | Fake inbox for testing. Delete it for real use. |

**Deliberately not included:** file storage and image proxying (this app uploads
no files), realtime subscriptions (nothing subscribes), Logflare analytics and
the log shipper, and connection pooling. They are in Supabase's own compose file
if you want them; Logflare in particular is the most common reason a self-hosted
Supabase will not boot, and nothing here needs it.

---

## Three things that will trip you up

### 1. There are two sync config files and only one is yours

```
powersync/sync-rules.yaml     <-- self-hosted. This is the one you edit.
powersync/sync-streams.yaml   <-- PowerSync Cloud only. Ignore it.
```

Both are real, both are committed, and they are different formats for the same
rules — `bucket_definitions` versus Sync Streams edition 3. The self-hosted
service reads **`sync-rules.yaml`**. Edit `sync-streams.yaml` and nothing you
change will have any effect, with no error to tell you why.

If you are changing what syncs to whom, that is the file, and
`selfhost/docker-compose.yml` mounts it.

### 2. A device can end up claiming an account with the wrong key

**Symptom.** You sign into a second account on a device that has already been
used with a different one, and you are never shown a recovery code. Later, notes
from that account arrive on another device and cannot be decrypted.

**Cause.** One device has one data key. The device offers its existing key to
each account it signs into, and if that account has no key on record it is
accepted — including when the key really belongs to a different account and no
recovery code was ever issued for this one.

**Why you cannot just fix it.** The `user_keys` table has a policy allowing
`INSERT` and a policy allowing `SELECT`, and deliberately nothing for `UPDATE` or
`DELETE`. That is not an oversight. A key that could be swapped in place is a key
that can silently orphan every note already encrypted under the old one, with no
way back. Insert-only means the failure is recoverable; editable would mean it is
not.

**The fix**, out-of-band, with the service key:

```bash
npx tsx scripts/repair-shared-account-keys.ts
```

It prints what it would do and changes nothing. Re-run with `--apply` to delete
the duplicate key rows, keeping the oldest claimant of each. Those accounts then
run key setup on next sign-in and get a real recovery code.

It does **not** touch notes. Anything already encrypted under the old key stays
encrypted under it; the app flags those as undecryptable rather than overwriting
them, so if the original recovery code turns up they can still be read. Deleting
them would be the irreversible option, and the script does not make that choice
for you.

The script is written against a local dev stack; read the header before pointing
it at anything you care about, and back up first.

### 3. The database is the only copy

`docker compose down -v` deletes the volume, and the volume is the notes.
Devices hold their own encrypted copies, so a wipe is survivable if a device
still has the data — but the server has no backup of its own. Take one:

```bash
docker exec notes-selfhost-db-1 pg_dump -U supabase_admin postgres > backup.sql
```

---

## Troubleshooting

**Containers exit with code 137.** Out of memory — the OS killed them, and
nothing in the logs will say so. Give Docker at least 4 GB. Running two Supabase
stacks at once will do this on a 4 GB allowance, so if you are also running the
`supabase` CLI for development, stop it first.

**`port is already allocated`.** Something else holds one of the published
ports. Change it in `.env` — `KONG_HTTP_PORT`, `POWERSYNC_HTTP_PORT`,
`POSTGRES_HOST_PORT`, `STUDIO_PORT`, `MAILPIT_PORT` — and remember to update
`API_EXTERNAL_URL` and the `EXPO_PUBLIC_*` URLs to match if you moved Kong or
PowerSync.

**`auth` or `rest` restart forever, "password authentication failed".** The
role passwords are set by a script that runs only when the data volume is first
created. If you changed `POSTGRES_PASSWORD` after the first start, the database
still has the old one. Either put the old value back, or
`docker compose --env-file ../.env down -v` and start clean — which deletes the
data.

**PowerSync is healthy but nothing syncs.** Almost always
`POWERSYNC_REPLICATION_PASSWORD`. The schema creates the replication role with
no password on purpose, so a working password never ends up in a committed file,
and `selfhost/migrate.sh` sets it afterwards. If that step did not run, PowerSync
logs `28P01 password authentication failed for user "powersync_role"` and syncs
nothing while every container still reports healthy. Check with:

```bash
docker compose --env-file ../.env logs powersync | grep -i "replication slot"
```

A working stack logs `Created replication slot` and then
`Activated new replication stream`.

**PowerSync warns about Supabase Auth at startup.** This line is expected on
every start and is not a problem:

```
Supabase Auth is enabled, but no Supabase connection string found.
Skipping Supabase JWKS URL configuration.
```

It only means the service could not auto-discover a key URL from the database
connection string, which never works outside hosted Supabase. Verification is
done with the shared secret instead, which is configured explicitly.

**Requests return 401 with a valid-looking key.** The gateway wants the key in
an `apikey` header, not only in `Authorization`. That includes health checks:

```bash
curl -H "apikey: $ANON_KEY" http://127.0.0.1:8000/auth/v1/health
```

**Sign-in emails never arrive.** Expected, unless you configured `SMTP_*` —
they are in Mailpit at <http://127.0.0.1:8025>.

---

## Running it on a real server

The compose file exposes ports directly, which is right for a laptop and wrong
for the public internet. On a server:

- Put a TLS-terminating reverse proxy in front and bind the published ports to
  `127.0.0.1` instead of `0.0.0.0`. Sign-in tokens over plain HTTP are readable
  in transit — note *content* stays encrypted regardless, but session tokens do
  not.
- Do not expose `POSTGRES_HOST_PORT` at all.
- Set `DISABLE_SIGNUP=true` once your devices are enrolled.
- `SERVICE_ROLE_KEY` bypasses row-level security completely. It belongs on the
  server and nowhere else.
- Back up the volume.

---

## How far this has been verified

Honest scope, because the difference matters if something does not work for you.

**Confirmed by running it:** the stack boots from empty; all eight services
reach healthy and `migrator` exits 0; the schema applies and `user_keys` has
exactly the two policies described above; PowerSync creates a replication slot
and begins replicating `public.notes`; the gateway routes to GoTrue and
PostgREST and rejects requests without an `apikey`; re-running `up` does not
re-apply migrations; and `down -v` followed by `up` reproduces all of it from
scratch.

**Not yet confirmed end to end:** a full signup-and-sync round trip — creating
an account against this stack from the app and watching a note replicate to a
second device. The token verification path in particular is configured from the
PowerSync service's own source rather than proven with a live client. If you hit
a wall there, please open an issue; that is the gap.
