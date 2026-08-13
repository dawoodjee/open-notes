# Notes

An open-source, cross-platform notes app that opens as fast as Apple Notes,
syncs quietly in the background, and stores nothing the server can read.

Self-hostable. MIT licensed. Built with React Native and Expo, on Supabase and
PowerSync.

---

## The idea

Apple Notes has the feel — instant, frictionless, always synced — and total
lock-in with no API. Obsidian has the openness and a setup process that defeats
people. This is an attempt at both halves: something you can start writing in
before you have an account, that syncs across your devices, that you can host
yourself, and that other apps can build on when you say so.

**No login wall.** The app opens straight into a note and works offline. Sync is
something you switch on.

**End-to-end encrypted, by construction.** Note titles and bodies are encrypted
on the device before they are sent. The database holds `enc:v1:` envelopes; the
key lives in your device's Keychain or Keystore, plus one copy on the server
wrapped under a twelve-word recovery code that only you hold. There is no admin
path and no support path. Self-hosting does not change this — the guarantee
never depended on who runs the server.

The direct cost of that: lose the recovery code **and** every signed-in device
and the notes are gone. Not "until support restores them" — gone. The app says
so in those words rather than softening it.

**Access on your terms, not by default.** Every note has a *Visible to Apps*
toggle. Anything reading note content goes through a broker with per-destination
consent, an expiry, single-use grants scoped to named notes, and an audit log of
every disclosure. Default-deny: a tool that does not ask for plaintext gets
metadata.

---

## Status

Working and used daily on iOS, iPadOS and Android: local-first editing, sync,
email and Google sign-in, end-to-end encryption with cross-device key recovery,
per-note app-access control, dark mode.

Not working: **web and desktop** (entry points exist, unverified — see the
[roadmap](docs/roadmap.md)), **Apple sign-in** (needs credentials), and there is
**no MCP server yet**, only the seam it will plug into.

This is a personal project built in the open. Expect rough edges.

---

## Getting started

**Run the backend** — [docs/self-hosting.md](docs/self-hosting.md). One
`docker compose up`, with enough Docker explanation to follow if you have never
used it.

**Build the app** — [docs/building.md](docs/building.md). iOS/iPadOS and
Android, development and distributable builds.

**Where it's going** — [docs/roadmap.md](docs/roadmap.md).

**Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests welcome.

**Why encryption shapes everything else** — [NOTES.md](NOTES.md). Which AI
features fit inside the model and which need an explicit opt-in pipe.

---

## Licence

MIT. See [LICENSE](LICENSE).
