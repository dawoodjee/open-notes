# What end-to-end encryption means for the AI features

Stage 6 changed a constraint that every later feature has to be designed
around, so it's worth stating plainly before anything gets built on top of it.

**The server cannot read your notes.** Not "doesn't", *cannot*. `notes.body`
and `notes.title` in Postgres hold `enc:v1:` envelopes, and the key that opens
them exists in exactly two places: the device's Keychain, and a copy on the
server wrapped under a 125-bit recovery code that only the user has. There is
no admin path, no support path, and no "just this once" path. Any feature that
needs to read note content either runs on the device or gets that content
handed to it deliberately.

That isn't a limitation to engineer around. It's the product.

---

## Safe by default: anything on-device

These need no new pipe, no consent flow, and no change to the model. After
unlock, plaintext exists in memory on the device, which is where these run.

- **On-device inference** — summarising, tagging, "what did I say about X",
  extracting dates or todos, semantic search. The model sees plaintext because
  it's running inside the app; nothing leaves.
- **On-device embeddings and semantic search.** Worth calling out separately:
  embeddings are derived from plaintext, so they leak content and must be
  treated exactly like `note_sync_base` — stored in the local SQLCipher
  database, never synced, never uploaded. An embedding index shipped to a
  server would quietly undo this entire stage.
- **On-device fine-tuning / personalisation.** Same reasoning. The adapter
  weights are derived from your notes and are as sensitive as the notes, so
  they stay local and stay out of the sync bucket.
- **Local-only scratch state.** The `localOnly` pattern already used by
  `ui_state`, `sync_issues` and `note_sync_base` is the right home for any
  derived artefact.

The rule of thumb: *if it is derived from plaintext, it is as sensitive as
plaintext.* Deriving something doesn't launder it.

---

## Needs an explicit, opt-in pipe: anything server-side

A hosted model cannot be handed ciphertext and do anything useful with it. So
any server-side AI feature requires the app to decrypt locally and send
plaintext out — which is a real, visible change in what the product promises.

This was built in Stage 6.5. See `lib/plaintext/`.

### Amended: the per-action consent rule

This section originally said **"per-action consent, not a settings toggle"**,
on the grounds that a switch buried in settings which silently uploads
plaintext forever is precisely what this stage exists to prevent. That is still
the right description of the failure mode, and the two toggles now in
Settings → Security do not simply overrule it. What shipped is a toggle *plus*
the things that stop it becoming that switch:

- **An expiry.** 30 / 90 / 365 days, or Forever if the user insists. Turning
  one on defaults to 90 days, so the safer option is the one you get by not
  thinking about it. A permission that lapses cannot outlive the reason it was
  granted.
- **Per-request scope.** `requestPlaintext()` takes explicit note ids. There is
  deliberately no "all notes" form, so a gate being on never means "everything
  is readable".
- **Per-destination consent.** The first time plaintext would go to a given
  endpoint, the user is asked, and the prompt names the host. Editing an
  endpoint's URL clears that approval, so "approve something harmless, then
  repoint it" is not a bypass.
- **An audit log.** Every disclosure writes a row to `plaintext_disclosures`
  before the request goes out — ids and byte counts, never content. That is
  what makes a standing permission inspectable rather than a promise.

The remaining rules are unchanged and were implemented as written:

1. **Scoped to what was asked.** Send the one note, not the notebook. Never
   background-sync plaintext "so the feature feels fast".
2. **Named in the UI, at the point of use.** The user should be able to tell,
   without reading a policy, which actions leave the device.
3. **A separate transport.** Not the `notes` table, not the sync bucket, and
   deliberately not a PostgREST path — `lib/plaintext/` imports Supabase
   nowhere, asserted by `scripts/verify-plaintext-gates.ts`. The sync path
   must keep its current property, that everything travelling through it is
   opaque to the server, because that property is only useful with no
   exceptions.
4. **No retention by default.** Send, use, discard. A grant is single-use and
   expires after 60 seconds.

### The one thing that did not move

The server never gains the ability to decrypt. No key copy, no escrow, no
"just this once". Plaintext leaves the device only because the device
decrypted it for one named request, and `getDataKey` is unreachable outside
`lib/crypto/` — enforced by a lint rule and by a grep assertion in CI, not by
convention.

---

## Things that quietly break the model

Worth writing down because each one is an easy, well-intentioned mistake:

- Uploading embeddings, summaries, extracted entities, or search indexes.
  All derived from plaintext; all leak it.
- Server-side full-text search. Impossible by construction now, and the
  workaround (upload a searchable copy) defeats the point. Search stays
  client-side over decrypted notes — see `components/NoteListPane.tsx`.
- Putting note text into error reports, analytics, or crash logs.
  `sync_issues` deliberately stores a message and a `note_id`, never content.
- Server-side "smart" features that need to scan all notes — reminders,
  digests, notifications about content. These have to run on-device or not at
  all.
- Sharing and collaboration. Not impossible, but it is a real cryptographic
  design problem (per-note keys wrapped for each recipient), not a feature
  that can be added by relaxing RLS.

---

## The one thing users must understand

Lose the PIN **and** the recovery code **and** every signed-in device, and the
notes are gone. Not "gone until support restores them" — mathematically gone.
That is the direct cost of the guarantee, and the setup flow says so in those
words rather than softening it.
