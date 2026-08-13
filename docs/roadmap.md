# Roadmap

## What this is for

Notes that belong to the person who wrote them.

That is meant literally, as three properties the code already has:

**Stored locally first.** The app opens straight into a note and works offline,
signed in or not. Sync is something you turn on, not something you submit to.
There is no login wall in front of writing something down.

**Encrypted so that no server can read them — including your own.** Note titles
and bodies are encrypted on the device. Postgres stores `enc:v1:` envelopes. The
key exists in two places: the device's Keychain or Keystore, and a copy on the
server wrapped under a twelve-word recovery code that only the user has. There
is no admin path and no support path. [Self-hosting](self-hosting.md) does not
change this, because the encryption never depended on who ran the server.

**Open to other apps and to AI on explicit terms.** This is the part that is
usually a promise. Here it is already built, and it is worth being specific
about what "built" means, because the roadmap below is honest about what is not.

In `lib/plaintext/`: a broker that is the only way to obtain decrypted note
content, gates with an expiry (30/90/365 days, defaulting to 90 — the safer
option is the one you get by not thinking about it), per-destination consent
that names the host and is revoked if the destination's URL changes, and an
audit log that records every disclosure — note ids and byte counts, never
content — before the data leaves. Grants are single-use, scoped to named notes
(there is deliberately no "all notes" form), and expire after 60 seconds. Every
note has a **Visible to Apps** toggle, and a note switched off is excluded from
metadata listings too, not merely from content — because the existence and
timing of a hidden note is most of what someone hiding it is trying not to say.

Default-deny throughout: a tool that does not declare it needs plaintext gets
metadata and works in a degraded way, rather than silently getting the notes.

The four directions below build on that. Nothing here is a commitment to a date.

---

## 1. Web and desktop

**Status: not working. Entry points exist; they have not been made to run.**

`app.json` sets `web.output: "single"`, `npm run web` exists, and there is a web
build of the editor at `components/RichEditor.web.tsx`. None of that has been
verified end to end, and it should not be read as "web nearly works".

**The blocker is specific.** PowerSync's web client needs a different SQLite
implementation from the native one: WebAssembly (wa-sqlite, via
`@powersync/web`) rather than the native module the app uses today. That is not
a configuration flag — it is a second storage backend, and the local database is
also where the at-rest encryption lives, so the encryption story has to be
answered again for the browser rather than assumed.

**Desktop is genuinely undecided.** Two routes, and the choice has not been
made:

- *Wrap the web build* in Electron or Tauri. One codebase, ships as soon as web
  works, inherits whatever the browser storage answer turns out to be.
- *A separate native app.* Better platform integration and a real filesystem, at
  the cost of a third UI to maintain.

Neither has been picked, and web landing first would not settle it.

## 2. MCP server and app integrations

**Status: the seam is built. There is no server.**

`lib/plaintext/mcp.ts` says so itself:

> there is no MCP server in this repo yet. This is the seam, not the
> integration.

What exists is the shape of the contract: a tool manifest that must declare
`requiresPlaintext`, a resolver that asks the broker on **every invocation**
rather than once per session (a permission checked at startup outlives its own
expiry), and a metadata path that deliberately never reads the encrypted columns
at all — a query that never selects ciphertext cannot leak it.

The access-control model described at the top of this page is what any
integration will use. It was decided while the security model was fresh, rather
than under delivery pressure later.

Transport, discovery, and packaging are open. Nothing is claimed about them
here.

## 3. AI integration

**Status: the boundary is decided. No features are built.**

Stating the rule is more useful than listing features, because the rule is the
part that is hard to change later.

**On-device inference and on-device fine-tuning work within this model**, with
no new pipe, no consent flow and no exception — the key is already on the
device, so plaintext is already in memory after unlock. Summarising, tagging,
semantic search, extracting dates or todos: all of it can run locally.

One consequence that is easy to get wrong: **anything derived from plaintext is
as sensitive as plaintext.** Embeddings, summaries, extracted entities and
search indexes all leak content. They stay in the local encrypted database and
out of the sync bucket. Deriving something does not launder it — shipping an
embedding index to a server would quietly undo the entire encryption model.

**Anything server-side requires a separate, explicit, off-by-default opt-in
path.** Cloud inference and anonymized fine-tuning both mean decrypting on the
device and sending plaintext out, which is a real change in what the product
promises and has to be visible as one. It goes through the broker, the consent
prompt, the expiry and the audit log, exactly like any other endpoint — never as
a quiet exception in the sync layer.

That last clause is the commitment. The sync path's guarantee — that everything
travelling through it is opaque to the server — is only worth anything with no
exceptions, so the way to add a server-side AI feature is as an endpoint, not as
a special case. The server never gains the ability to decrypt: no key copy, no
escrow, no "just this once".

The full reasoning, including the failure modes, is in
[NOTES.md](../NOTES.md).

## 4. Apple sign-in

**Status: not started. Blocked on credentials, not on design.**

Currently a disabled row reading "Not available" in the account screen. It needs
a paid Apple Developer account to obtain the credentials — the same $99/year
that removes the [7-day build expiry](building.md). There is no design question
outstanding; email and Google sign-in already work through the same path.
