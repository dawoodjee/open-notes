# MVP Build Plan — Local-First Notes App (Claude Code)

**Goal:** ship the Phase 1 MVP — instant-open editor, silent reliable sync, end-to-end encryption, working self-host docs — while genuinely learning TypeScript, Expo SDK 54, NativeWind v5, Gluestack UI v5, Supabase, and PowerSync from a JS/HTML/CSS starting point.

**Build order:** the app is fully usable offline with real on-device persistence *before* any backend or login exists. Login is how you *sync*, never a precondition for use. PowerSync's local SQLite lands in Stage 2 in local-only mode (so there's no rewrite later); Supabase is built in parallel in Stage 4 without touching app storage; Stage 5 connects them and merges pre-login notes into the account; Stage 6 adds E2EE before any public release.

**Platform scope:** iOS + Android on `main`. PowerSync's web client needs its own SQLite workaround (no default op-sqlite support), and expo-sqlite — which does cover all three platforms — isn't PowerSync-supported. Web therefore lives on its own branch and rejoins `main` later.

**Status:** MVP complete — Stages 0–8 merged to `main` (repo public at `github.com/dawoodjee/open-notes`), v0.1 tagged. App is dogfooding on real iPad + two Android devices from the `live-stack` worktree against PowerSync Cloud + hosted Supabase. **One thing left before iteration 2 starts:** merge `fix/legacy-plaintext-backfill` (verified, see Decisions Log) — otherwise clear to begin, see the Iteration 2 section at the end.

---

## Working Practices

**Branching.** Every stage or feature gets its own branch off `main` (`stage-3-data-modeling`, `feat/e2ee-key-model`, `platform/web`). Merge to `main` only once that stage's checkpoint actually passes. Never commit straight to `main`.

**Plan Mode.** `Shift+Tab` twice (or `/plan`) before any non-trivial step — Claude explores read-only and proposes an approach before touching files. This is where the learning happens; read it properly rather than approving on reflex. If execution starts diverging from the approved plan, stop and re-plan rather than improvising.

**Verification over assertion.** Claude Code can query Postgres, run the Supabase/PowerSync CLIs, boot a simulator, and run tests from the terminal. Every checkpoint below that's really a *claim* (sync resolves silently, RLS isolates accounts, ciphertext is actually ciphertext) should be proven that way. For visual checks, screenshot the simulator and drop it into the chat.

**One prompt per stage.** Each stage below has a single consolidated prompt. Claude Code will likely break it into its own multi-phase plan — that's expected; read the plan carefully given how much ground each covers.

**Compacting.** Don't wait for the auto-compact warning — by then the context has already been degrading for a while. Run `/compact` proactively around 60% of the context window, using the standing rules in CLAUDE.md's Compact Instructions section. After compacting, ask it to restate the current stage, files changed, and what's next; if something load-bearing got dropped, correct it immediately while you'd still notice. Decisions you want to survive *any* number of future compactions (not just the next one) belong in this plan file or CLAUDE.md itself, not just in conversation — compaction summarizes chat, but it always re-reads files fresh.

### CLAUDE.md

**This block is the source of truth; the live file is at the repo root.** Claude Code reads `CLAUDE.md` from the project root at session start — it does not read this plan document unless told to. Edits made here reach Claude Code only once copied across. Re-sync after any change to this section.

Project root, read automatically at session start:

```markdown
# Project rules

## Who I am
I know plain JavaScript, HTML, and CSS well. I'm new to TypeScript, npm, Expo/React Native, NativeWind, Gluestack UI, Supabase, and PowerSync. Treat unfamiliar concepts as things to teach concisely, not just implement.

## Branching
Every stage or feature gets its own branch off main. Tell me the branch name when you start. Merge to main only when the stage checkpoint passes — never commit directly to main.

## Before writing code
For anything beyond a trivial fix, enter Plan Mode and pause for review. The plan must explain what you're about to do and why in beginner terms. If a step touches a tool I haven't used yet in this project, teach it — with a short example where it helps.

## While executing
Keep your todo list concrete and current. If reality diverges from the approved plan, stop and tell me rather than improvising.

## When you finish
Write a plain-language summary of every file you changed, tied to the underlying concept — the lesson for that step, not a changelog. Claude Code won't surface this automatically, so it's on you to always include it.

## Decisions
Default to deciding and moving. Choices that are cheap to reverse — file placement, naming, internal structure, how to factor a function, which built-in helper to use — just make them and note the call in one line in your summary. Don't stop for these.

Escalate before acting only when a choice is expensive to undo or changes something I'd notice as a user: data shape and schema, new dependencies, auth or security properties, sync and conflict behavior, or anything that changes stored data or visible product behavior. For those, tell me plainly and concisely — the options, your recommendation, and the tradeoff. I make that call.

The test when unsure: would undoing this in two weeks take minutes or days? Minutes, decide. Days, ask. And if I explicitly delegate a decision in a prompt ("decide and implement"), that overrides all of the above — just make the call.

When I accept a tradeoff on an escalated decision, record it in the Decisions Log in `dev-docs/mvp-build-plan.md` — the decision, the reasoning, and the consequence I accepted — before moving on.

## Front-load what needs me
Before starting execution, list everything in the task that will need my hands or my approval — physical device access, credentials, dashboard logins, OAuth consent screens, email verification codes, destructive steps needing sign-off — and get all of it done or confirmed up front. Don't discover these one at a time mid-run and stall waiting on me; by then I've likely stopped watching and the run sits idle. If something genuinely can't be front-loaded, say so and tell me exactly when in the run it will come up.

## Verification
Prove things rather than asserting them: use the terminal to run, boot, query, or test what you built, and show me the result.

## Compact Instructions

When compacting — automatic or manual — write a state snapshot, not a narrative
recap. If the current stage is complete, don't compact: write outcomes into
`dev-docs/mvp-build-plan.md`, commit, merge, `/clear`. A written handoff is inspectable;
a summary isn't.

Anything already committed or written to a file is durable — reference it by
path rather than re-summarizing it. Preserve only what exists nowhere but this
conversation. Compaction is lossy, so preserve in this order:

1. **Position** — current stage, branch name, and whether its checkpoint has passed.
2. **Uncommitted work** — every file touched this session and what changed in
   each. Not "updated the schema," but which columns/fields, in which file, and
   what's still unfinished.
3. **Decisions, with reasoning and tradeoff** — especially anything escalated to
   me under the Decisions rule and what I chose. Never silently drop an accepted
   tradeoff; a decision without its tradeoff gets relitigated. Anything already
   written to the Decisions Log in `dev-docs/mvp-build-plan.md` is durable — reference it
   by name, don't re-summarize it. Preserve decisions made this session that
   haven't been written down yet.
4. **Cross-stage deferrals** — what was deferred, which stage it lands in, and
   what forces it then. The landing stage is the half that goes missing and
   resurfaces as rework, so never record a deferral without it. Deferrals
   already captured in `dev-docs/mvp-build-plan.md` are durable — reference by path.
5. **Verification actually run** — which command, what it proved. Not "tests passed."
6. **Errors verbatim** — never paraphrased, never summarized.
7. **Open questions** — including concepts I asked about that aren't yet settled.

Fine to drop: exploratory dead ends that didn't change a decision, restated
explanations of concepts already taught this session, superseded plans once the
final approach is captured, and tool output already acted on.

Terse structured notes under these headings. Not prose. If a fact would need to
be looked up again to act on it, it wasn't preserved.

## Balance
Teach densely, not lengthily — maximum learning per word, and keep momentum. Concise is not shallow: compress the explanation, never the substance. Skip preamble, restatement of what the diff already shows, and boilerplate caveats.

Calibrate depth to novelty: go deep the first time a concept appears, one-line reminder on reuse. Prioritize what I couldn't have guessed — why this approach over the obvious alternative, what breaks otherwise, the gotcha specific to this tool. Don't pad to look thorough; the test is whether I could rebuild it myself, not length. Write complete working code in one pass — no teaching stubs or TODOs, since each checkpoint needs a real, testable result.

## Context discipline
Don't read node_modules/, android/, ios/, .expo/, assets/, or lock files unless I explicitly ask or a native build is actually broken. components/ui/ is generated Gluestack code — read a specific file if you need it, never the whole directory. Prefer targeted Grep/Glob over broad directory reads.

## Follow-up questions
If I ask "why" or push back, that's a continuation of the conversation, not a new task — answer in chat and only touch code again once I say to proceed.

## Environments
There are two backends — a wipeable local dev stack and a live cloud stack holding my real notes. Read `docs/two-stacks.md` before touching server config, migrations, sync rules, or builds.
```

### Token discipline (`.claudeignore` does not work)

`.claudeignore` is silently ignored by Claude Code — it's a widely-requested feature that was never implemented, and files listed in it get read anyway. Three mechanisms that do work, in order of reliability:

**1. `.claude/settings.json` — the hard block.** Denies the tool call outright:

```json
{
  "permissions": {
    "deny": [
      "Read(./node_modules/**)",
      "Read(./android/**)",
      "Read(./ios/**)",
      "Read(./.expo/**)",
      "Read(./assets/**)",
      "Read(./package-lock.json)",
      "Read(./yarn.lock)",
      "Read(./.env)",
      "Read(./.env.*)"
    ]
  }
}
```

Note `android/` and `ios/` are prebuild output — regenerable, and by far the biggest sinks in this tree (Gradle configs, Pods, native templates). Deny them by default and lift the rule temporarily on the rare occasion a native build genuinely needs debugging. Keep `.env` denied on principle even though secrets aren't the main concern here; deny rules have known gaps, so never rely on them as your only secret protection.

**2. `.gitignore` hygiene.** Claude Code respects it in the file picker, so a clean gitignore reduces what gets surfaced. Confirm it covers `node_modules/`, `.expo/`, `android/`, `ios/`, `*.log`, `.DS_Store`, and editor swap files (`*.swp`). Related cleanup: `components/.RichEditor.web.tsx.swp` is a stray vim swap file — delete it and gitignore the pattern.

**3. CLAUDE.md context discipline** (the section above). Softer than a deny rule but shapes behavior across every session, and covers the "don't read the *whole* directory" cases a binary allow/deny can't express — `components/ui/` being the main one, since Gluestack v5 copies dozens of component files into the project.

---

## Stages 0–5 — Complete ✅, merged to `main`

**Stage 0 — Scaffolding.** Expo SDK 54 + TypeScript template, ESLint + Prettier, strict mode clean.

**Stage 1 — UI foundations.** Gluestack UI v5 + NativeWind v5 wired at root. Single responsive split-pane layout: mobile list fills screen and minimizes entirely when a note opens; desktop keeps both panes visible with an independently tuckable list. Search bar, bottom-pinned "New Note", per-note last-edited time (time if today, date otherwise).

**Stage 2 — Local-first storage.** PowerSync client SDK in local-only mode (`lib/powersync/db.ts`, `schema.ts`), no backend connector. UUID ids via `expo-crypto`, ISO-string timestamps. Existing Tiptap editor wired as a controlled component backed by local SQLite. `useReducer` refactored to *mirror* PowerSync's watch/query output rather than own the data (`SET_NOTES`/`SET_LOADING`). Instant-open to last-viewed note, no loading screen, no auth.

**Stage 3 — Data modeling.** `Note` type reconciled against the local PowerSync schema; nullable `user_id` added to both, plus a matching drafted Postgres schema (`uuid` PK, `timestamptz`). Resolved real drift caught in review: dropped the phantom `isSynced` field, justified/handled the manual `version` column, fixed seed-data leaking into a synced account, confirmed the reducer watches reactively rather than one-shot fetching.

**Stage 4 — Supabase backend.** Schema applied to a real Supabase project for the first time. Passwordless auth: email OTP as primary, Google OAuth added (**Apple deferred — no credentials yet**, tracked as a known gap, not phone/SMS which was dropped entirely as a deliberate v1 scope call). `profiles` table: self-assigned unique usernames (ASCII-only, case-insensitive, reserved-name blocklist, 30-day change limit), RLS readable-by-any-authenticated/writable-by-owner. Notes RLS scoped to `user_id`, verified against two test accounts including a race-condition check on username uniqueness.

**Stage 4.5 — `full_name` amendment.** Added as a genuine schema amendment against the already-live Stage 4 project (not a plan rewrite): nullable, unconstrained free text, no coupling to `username` — best-effort backfilled from OAuth `raw_user_meta_data` for existing Google-linked test accounts, left null for email-only ones.

**Stage 5 — Real sync, auth UI, account linking.** Merged in full, all three phases verified against the live stack — see the project status doc for the exact evidence (account isolation, claim, linking, merge, all checked against real Postgres/SQLite state, not assumed). What shipped, including corrections made mid-build against the original plan:
- **Sync** (`lib/powersync/connector.ts`): CRUD queue drain uploads the row's *current local state*, not the queued op's stale payload — closes a real bug where a claimed note's upload could carry only the changed column instead of the full row. Only `23505` (unique violation) and `42703` (stale pre-Stage-5 queue entries) are dropped as unrecoverable; **RLS rejections now retry rather than drop** — the original plan's "drop on structural rejection" was too aggressive and was silently deleting local notes the first time it fired (an RLS rejection on a not-yet-claimed note isn't a permanent failure once claim runs, so dropping it destroyed real data). `sync_issues` (`localOnly`) surfaces genuinely-still-true problems, self-clearing when the underlying note later succeeds.
- **Claim step**: moved to run *inside* `becomeAuthenticatedLocally`, *before* `powersync.connect()` — not after, as originally planned. Running it after connect left a window where the connector could attempt (and drop) an unclaimed note's upload before claim ever touched it.
- **Auth** (`contexts/AuthContext.tsx`): `becomeAuthenticatedLocally` is the single entry point to an authenticated local session — in-flight-guarded against concurrent calls, routes `TOKEN_REFRESHED` through the same path (same-user refresh is a no-op session swap, not a reconnect), clears local SQLite only on a genuine account switch. Session storage: `expo-secure-store` + `aes-js` + `react-native-get-random-values`, using Supabase's documented `LargeSecureStore` pattern (one stable AES key in Keychain/Keystore, encrypted session blob in AsyncStorage) rather than plain AsyncStorage, since a real session plus linked identities was measured brushing SecureStore's ~2KB cap.
- **Logout**: `disconnectAndClear()` then `auth.signOut()`, `ui_state` wiped in the same clear, unsynced-write warning gated on a queue **count**, not a parsed list.
- **UI**: unified menu (Settings dialog with Change PIN/Appearance/Theme/Fonts stubs; Identity row swapping "Enable Sync" ↔ "Manage Account" by auth state). Manage Account: username + full name independently editable (one-directional suggestion only, sanitized from `full_name` when present, never the reverse), linked-accounts section (link/unlink Google, last-remaining-identity unlink correctly blocked by Supabase), email read-only (**email change is stubbed**, not built).
- **Conflict merge**: 3-way text merge on `body` via `diff-match-patch` against a `note_sync_base` (`localOnly`) common-ancestor table — verified on two concurrent offline "devices" editing different paragraphs, both edits survived in the merged result.

**Known gaps carried forward, not fixed in Stage 5:** Android hardware back is coded but unverified (no Android device in test setup); web platform remains on an abandoned WIP branch (`web-powersync`); trash has no restore/empty-trash UI surface yet (soft-delete itself works); Apple sign-in and email-change are both stubbed with honest in-UI messaging rather than silently broken.

---

## Stage 6 — End-to-End Encryption

> **⚠️ Superseded — read this before anything below.** This section describes the PIN+scrypt key-wrap model as originally planned and built in Phase 1–3. **It no longer reflects the running app.** Stage 6.5 (below) replaced the PIN with OS-level Face ID/Touch ID/passcode via `expo-local-authentication` (`lib/auth/deviceAuth.ts`), removing `react-native-quick-crypto`/scrypt entirely — confirmed cleanly removed, no dead imports, per the iteration-2 codebase audit. The wrapped-key-in-Supabase model, the 12-word recovery code, and the merge-on-plaintext fix are all still accurate; only the *unlock mechanism* changed. Kept below as historical record of the reasoning, not as current architecture. **`docs/roadmap.md` and `NOTES.md` are the accurate, current public-facing description of the encryption model.**

**Learn:** AES-GCM, key wrapping, PIN entropy, why TLS ≠ E2EE, where keys may live (never the server), encryption at rest, and why a client-side conflict merge has to run on plaintext.

Three phases, same discipline as Stage 5: fully verify each before starting the next. Two things below aren't in a naive version of this stage — they exist because of what Stage 5 actually shipped, not because they were planned in the abstract: `aes-js` (already a dependency) doesn't implement GCM, and Stage 5's 3-way merge (`mergeBody.ts`, `note_sync_base`) breaks silently the moment `body` is ciphertext instead of plaintext, unless the merge itself is restructured in the same pass that adds encryption.

**Build — Phase 1: local key model, PIN screens, at-rest encryption.**
- **PIN wraps a locally-stored key; it is not the key.** On first use — before any login — generate a high-entropy data key on-device, stored in `expo-secure-store` (already a Stage 5 dependency — reuse it, don't add a second secrets library). The 6-digit PIN is an unlock gate for that key, protected by the OS's own attempt limiting. A true PIN-derived cross-device unlock (WhatsApp/Signal's model) needs server-side or HSM-backed rate limiting to be safe — out of scope for v1. **Accepted consequence:** a new device can't decrypt from PIN alone; it needs login + wrapped-key retrieval, with the PIN unlocking what's been retrieved.
- **AES-GCM implementation: add `@noble/ciphers`, don't hand-compose it on `aes-js`.** `aes-js` only implements CBC/CTR/ECB/OFB — none authenticated. Building encrypt-then-MAC by hand on top of it is real don't-roll-your-own-crypto territory. Flag `@noble/ciphers` as a new dependency per the decisions rule and confirm it's the right call before proceeding — small, pure JS, RN-safe.
- **PIN setup screen**, shown once on very first app launch (before any note UI, before login) — the only screen in the whole app allowed to block, since without a PIN there's no key to encrypt the first note with. Generate and display the recovery code here too, with an explicit "I've saved this" confirmation required before it dismisses.
- **PIN unlock screen**, shown on cold launch and after backgrounding past a timeout, gating the existing list/editor UI rather than replacing it — the app underneath is already loaded, just not decryptable yet.
- **Encrypt the local SQLite database at rest, covering the whole file** — `notes`, `ui_state`, `sync_issues`, and `note_sync_base` all included, not just the notes table specifically. Confirm what encryption mechanism is actually compatible with PowerSync's SQLite core before implementing — don't assume a specific approach works without checking.
- *Verify before Phase 2*: PIN setup and unlock work end-to-end; the data key persists across app restart and is retrievable only after correct PIN entry; the local SQLite file is unreadable if pulled off the device and opened directly. Report actual results.

**Build — Phase 2: note content encryption, merge adapted, PIN change.**
- Encrypt note `title` and `body` client-side before they reach the columns PowerSync syncs — Postgres only ever stores ciphertext for content. Leave `id`, `user_id`, `is_trashed`, `trashed_at`, and timestamps unencrypted, since RLS and sync rules only filter on those.
- **This can't ship as an isolated change — it directly breaks Stage 5's 3-way merge unless the merge path is restructured in the same pass.** AES-GCM uses a fresh nonce per encryption, so re-encrypting *unchanged* plaintext produces different ciphertext every time. `note_sync_base`'s "does it still match?" check would misfire as a conflict on every save, and diffing two unrelated ciphertext blobs produces a diff with no relationship to the actual edits — corrupted or nonsensical merges, not just missed ones. Fix:
  - `note_sync_base` keeps storing **plaintext**, not ciphertext — safe now specifically because the whole local database is encrypted at rest as of Phase 1.
  - `connector.ts`'s upload path: fetch the server's current ciphertext, decrypt it locally with the data key, run the existing 3-way merge (against `note_sync_base` and the local plaintext edit) on **decrypted plaintext**, then encrypt the merged result before uploading.
  - Explicitly confirm a no-op re-save (open a note, close it with no edits) doesn't get misclassified as a conflict just because re-encrypting identical plaintext produced different ciphertext bytes.
- **Wire the "Change PIN" row at `SettingsDialog.tsx:145`** (currently `onPress={() => {}}`) to a real change-PIN screen (old PIN, new PIN, confirm). Key **re-wrap**, not re-encryption: unwrap with the old PIN, re-wrap under the new one, prove in your summary that no note content gets touched or re-uploaded.
- Periodic low-friction "still remember your PIN?" prompts, PIN-only, never logged/emailed/transmitted.
- *Verify before Phase 3*: repeat Stage 5's two-device concurrent-edit test (different paragraphs, both offline, both reconnect) — confirm both edits still survive in the merged result and the final Postgres row is genuine ciphertext. Confirm a PIN change re-wraps without re-encrypting or re-uploading any note. Report actual results, including a direct Postgres query showing ciphertext.

**Build — Phase 3: cross-device key distribution, recovery, final review.**
- **Wrapped data key in a new dedicated table, not a `profiles` column.** `profiles` RLS is deliberately readable by any authenticated user (that's what makes username availability checks work) — putting key material there means every signed-in user could read every other user's wrapped key. Owner-only read and write on the new table. Extend the same migration file already established in Stage 4/5, per its own header convention.
- On login on a second device/session, retrieve the wrapped key blob and unwrap it client-side with the PIN. Test using the existing test accounts (e.g., sign into `user-a@test.local` on a second local session) rather than creating new ones.
- Recovery code: generated once at PIN setup (Phase 1), delivered by email as a one-time save-this-safely moment. Write plain-language copy for what's recoverable (recovery code, or a still-logged-in second device) versus genuinely unrecoverable (lost PIN, no saved code, no other device).
- Confirm search still runs entirely against decrypted local data, never a server-side query.
- **Final adversarial pass**: query Postgres directly and confirm every note's title/body is real ciphertext; confirm the wrapped-key table isn't readable by a second test account; hunt for any point where plaintext content or the PIN itself could leak to server, logs, or an unencrypted local file.
- Write `NOTES.md` documenting which Phase 2-roadmap AI features are safe as on-device inference/fine-tuning under this model versus which need a separate opt-in pipe.

**Phase 2-roadmap implications (decide now, build later):** on-device inference and on-device fine-tuning are boundary-safe — the app already holds the key locally. Server-side inference or opt-in anonymized fine-tuning must be a *separate, explicit pipe* with its own consent, a real de-identification step, and an off-by-default toggle — never a sync-path exception. Connected third-party apps need scoped, revocable, per-app grants brokered on-device, never server-side decryption on their behalf.

**Checkpoint:** Postgres shows only ciphertext for title/body; the local SQLite file (all four tables, not just `notes`) is unreadable off-device; a second device/session decrypts after login without the raw key ever transiting the server, from a table it alone can read; PIN change re-wraps without touching note ciphertext; the two-device merge still works correctly on encrypted content; a recovery code (not the PIN) is what's generated and delivered, with explicit confirmation before the setup screen dismisses; what is and isn't recoverable is written down.

**Prompt:**

```
Create a branch `stage-6-e2ee` off main; merge back only once Phase 3's checkpoint passes. Three phases, same discipline as Stage 5: fully verify each before starting the next.

CONTEXT: Stage 5 is merged. Auth is email OTP + Google only (no Apple, no phone/SMS). becomeAuthenticatedLocally in contexts/AuthContext.tsx is the single entry point to an authenticated local session, with claim running before connect(). expo-secure-store and aes-js are already dependencies (used for session storage). Test accounts already exist: user-a@test.local, user-b@test.local, phase2-verify@test.local, and the owner’s own Google account (Google-linked) — reuse these, don't create new ones. Note: ModalBody is a ScrollView, so its gap-* className doesn't space children (already discovered in Stage 5) — don't rediscover this, use whatever workaround Stage 5 landed on for any new dialog spacing.

PHASE 1 — Local key model + PIN screens + at-rest encryption.

Key model: on first app use, even before login, generate a high-entropy data key on-device and store it in expo-secure-store (already a dependency — reuse it, don't add a second secrets library). The user's 6-digit PIN unlocks that stored key rather than deriving it directly; a bare 6-digit PIN is too weak to be an encryption key's only protection. Deliberately skip a true PIN-derived cross-device unlock (WhatsApp/Signal's approach) — that needs server-side or HSM-backed rate limiting, out of scope for v1. Accepted consequence: a brand-new device needs a real login, not just the PIN, to retrieve and unlock existing notes.

For the actual AES-GCM implementation: aes-js doesn't support GCM (only CBC/CTR/ECB/OFB, none authenticated). Add @noble/ciphers rather than hand-composing encrypt-then-MAC on top of aes-js — flag this as a new dependency and confirm it's the right call before proceeding.

Build a PIN setup screen shown once on first launch, before any note UI and before login — the only screen in this app allowed to block, since there's no key to encrypt anything with until it's set. Build a separate PIN unlock screen shown on cold launch and after backgrounding past a timeout, gating the existing list/editor UI rather than replacing it — the app underneath is already loaded, just not decryptable yet.

Encrypt the local SQLite database at rest, covering the whole file — notes, ui_state, sync_issues, and note_sync_base all included, not just the notes table specifically. Confirm what encryption mechanism is actually compatible with PowerSync's SQLite core before implementing — don't assume a specific approach works without checking.

Verify before Phase 2: PIN setup and unlock work end-to-end; the data key persists across app restart and is retrievable only after correct PIN entry; the local SQLite file is unreadable if pulled off the device and opened directly. Report actual results.

PHASE 2 — Note content encryption, adapted merge logic, PIN change.

Encrypt note title and body client-side before they reach the columns PowerSync syncs — Postgres should only ever store ciphertext for content. Leave id, user_id, is_trashed, trashed_at, and timestamps unencrypted, since RLS and sync rules only filter on those and trash state doesn't need protecting differently from anything else.

This can't be done as an isolated change — it directly breaks Stage 5's 3-way merge (mergeBody.ts, note_sync_base) unless the merge path is restructured in the same pass:
- note_sync_base keeps storing plaintext, not ciphertext — this is safe now because the whole local database is encrypted at rest as of Phase 1.
- connector.ts's upload path needs to: fetch the server's current ciphertext for that note, decrypt it locally with the data key, run the existing 3-way merge (against note_sync_base and the local plaintext edit) on the decrypted plaintext — not on ciphertext — then encrypt the merged result before uploading.
- Confirm explicitly that a no-op re-save (opening a note and closing it with no edits) doesn't get misclassified as a conflict just because re-encrypting unchanged plaintext produces different ciphertext bytes.

Wire the "Change PIN" entry at SettingsDialog.tsx:145 (currently onPress={() => {}}) to a real change-PIN screen (old PIN, new PIN, confirm). This is a key re-wrap, not a re-encryption: unwrap the data key with the old PIN, re-wrap it under the new one, and prove in your summary that no note content gets touched or re-uploaded as a result.

Add a periodic, low-friction reminder asking the user to re-enter their PIN so muscle memory doesn't fade, prompting for the PIN only — never logging, emailing, or transmitting it anywhere.

Verify before Phase 3: create a note, edit it from two "devices" while both offline in different paragraphs (same pattern as Stage 5's two-device merge test), bring both online, confirm both edits survive in the merged result and the final Postgres row is genuine ciphertext. Confirm a PIN change re-wraps without re-encrypting or re-uploading any note. Report actual results, including a direct Postgres query showing ciphertext.

PHASE 3 — Cross-device key distribution, recovery, final review.

Add a new table (not a column on profiles) for the wrapped data key blob — owner-only read and write, deliberately not using profiles' existing "readable by any authenticated user" policy, since that's specifically there for username availability checks and shouldn't extend to key material even though it's encrypted. Extend the same migration file already established in Stage 4/5, per its own header convention.

On login on a second device/session, retrieve the wrapped key blob and unwrap it client-side with the PIN. Test this using the existing test accounts (e.g., sign into user-a@test.local on a second local session) rather than creating new ones.

Recovery: generate a separate high-entropy recovery code once at PIN setup — never the PIN itself — delivered by email as a one-time "save this somewhere safe" moment with an explicit confirmation required before the setup screen dismisses. Write plain-language copy for what's recoverable (recovery code, or a still-logged-in second device) versus genuinely unrecoverable (lost PIN, no saved code, no other device).

Confirm search still runs entirely against decrypted local data, never a server-side query.

Final adversarial pass: query Postgres directly and confirm every note's title/body is real ciphertext, confirm the wrapped-key table isn't readable by a second test account, and hunt for any point where plaintext content or the PIN itself could leak to server, logs, or an unencrypted local file.

Write NOTES.md documenting which Phase 2-roadmap AI features are safe as on-device inference/fine-tuning under this model versus which need a separate opt-in pipe.

Verify: full checkpoint — ciphertext confirmed in Postgres; local file unreadable off-device; second device/session decrypts without the raw key transiting the server; PIN change re-wraps without touching notes; recovery code (not PIN) is what's actually generated and delivered; two-device merge still works correctly on encrypted content. Report all results verbatim.
```

One open call left to you rather than baked in: whether PIN unlock timeout should be "every cold launch" only, or also after some backgrounding duration — that's a UX decision, not a technical one, worth deciding explicitly before or during Phase 1.

---

## Stage 7 — Documentation: Self-Hosting, Builds, Roadmap

**Learn:** just enough Docker to package a self-hostable backend; writing setup docs that survive contact with someone who isn't you.

Scope expanded beyond the original "self-hosting docs only" — this is now the project's full public-facing documentation pass, since the repo is going out as an open-source foundation rather than a personal build.

**Build:**
- **Self-hosting docs**: standing up Supabase + PowerSync from scratch. MVP scope is _documentation_, not the one-step installer (Phase 3).
- **`.env.example` as the entry point, not prose.** Enumerate every environment variable the project actually reads (don't invent names — grep the repo), each with a one-line comment saying what it is and where to get it. Instructions tell the reader to `cp .env.example .env` and fill it in, rather than describing variables in paragraphs they then have to transcribe.
- **Call out the two sync config formats explicitly.** `powersync/sync-rules.yaml` (`bucket_definitions`) is the self-hosted one; `powersync/sync-streams.yaml` is PowerSync Cloud's Sync Streams ed. 3 format. Both are real and both are in the repo — a self-hoster who edits the wrong one gets a confusing failure.
- **Document the `user_keys` constraint**: no UPDATE or DELETE policy by design, so a mis-claimed key is only fixable out-of-band via `scripts/repair-shared-account-keys.ts`. Someone will hit this.
- **E2EE guarantee note**: self-hosters get the same protection as the hosted version — encryption happens on-device, so a self-hosted server never sees plaintext note content either. This is a core part of the pitch, state it plainly.
- **Build instructions for iOS/iPadOS and Android** — development builds and distributable builds, including the free-Apple-personal-team 7-day signature expiry and what the paid program ($99/yr) changes.
- **Roadmap section** — where this project is going beyond the MVP (see below; confirm scope before writing).
- **Contributing section** — community pull requests welcome, with enough guidance that a first-time contributor knows how to run the stack and what a good PR looks like.

**Checkpoint:** a stranger following the docs alone can stand up a working self-hosted backend, build the app for their own iPhone/iPad and Android device, and understand what the project is for and how to contribute.

**Prompt:**

```
Create a branch `docs/public-documentation` off main; merge back once the checkpoint passes.

Write the project's public documentation. Be concise throughout — short explanations, no padding, no restating what a command obviously does. Assume a reader who is technically capable but new to this specific stack. Where something is genuinely non-obvious, one clear sentence beats a paragraph.

1. SELF-HOSTING
Write a docker-compose.yml to self-host Supabase and PowerSync together, plus step-by-step setup docs. Cover just enough Docker (containers, images, compose) for someone who hasn't used it, and say what each service in the compose file does.

Three things that will trip people up and need explicit callouts:
- The repo contains TWO sync configs in different formats, both real: powersync/sync-rules.yaml (bucket_definitions, self-hosted) and powersync/sync-streams.yaml (PowerSync Cloud, Sync Streams ed. 3). Self-hosters need the first. Say so where they'd otherwise guess.
- user_keys has no UPDATE and no DELETE policy by design. A mis-claimed key can only be repaired out-of-band via scripts/repair-shared-account-keys.ts. Document the symptom and the fix.
- Self-hosters get the same end-to-end encryption guarantee as the hosted version, since encryption happens on-device — a self-hosted server never sees plaintext note content either.

2. ENVIRONMENT VARIABLES — template-first
Grep the repo for every environment variable actually read (app code, scripts, powersync configs, supabase config, docker-compose) and create a committed .env.example containing all of them. Do not invent or guess variable names — use the real ones. Each entry gets a one-line comment: what it is, where to obtain it, and whether it's required or optional. Mark clearly which are safe to expose to the client (EXPO_PUBLIC_ prefixed) and which must never be.

The setup instructions should tell the reader to copy the template and edit it — `cp .env.example .env` — rather than describing variables in prose they'd have to transcribe. .env.example is committed; .env stays gitignored. Confirm .gitignore already covers it.

3. BUILDING THE APPS — iOS/iPadOS and Android
Document both, covering development builds (running on your own device from source) and distributable builds. Include:
- Prerequisites per platform (Xcode, Android Studio/SDK, device setup).
- Why Expo Go doesn't work here — the project uses native modules (expo-secure-store, expo-web-browser, expo-auth-session, SQLCipher), so a dev client or prebuild is required.
- iOS: the free Apple personal team gives 7-day signature expiry, requiring a re-install over USB roughly weekly. The paid Apple Developer Program ($99/yr) removes this and unlocks EAS OTA updates. State both plainly so a reader can choose.
- Android: the equivalent path, including anything the project needs that differs from iOS.
- The commands that already exist in package.json rather than generic Expo instructions.

4. ROADMAP
Frame the project's purpose first: this is the foundation for cross-platform notes that genuinely belong to the person who wrote them — stored locally first, encrypted so that no server (including a self-hosted one) can read them, and open to extension by other apps and by AI on the user's explicit terms rather than by default. The per-note "Visible to Apps" toggle and the plaintext broker in lib/plaintext/ are that principle already implemented, not an aspiration — reference them as evidence.

Then name these four directions, and only these — don't invent others. Be honest about status; overstating readiness in public docs is worse than saying "not started."

- Web and desktop. Web entry points already exist (app.json web.output: single, npm run web, components/RichEditor.web.tsx) but are unverified — say so plainly rather than implying they work. Name the known blocker: PowerSync's web client needs a different SQLite backend (wa-sqlite/WASM via @powersync/web) than the native op-sqlite path, which is why this isn't already done. Desktop is genuinely undecided between wrapping the web build (Electron/Tauri) and a separate native app — present both as open options, don't pick one.

- MCP server and app integrations. The seam is designed and in the repo (lib/plaintext/mcp.ts, manifest shape, default-deny) with no server behind it yet — the file says as much itself. The per-note "Visible to Apps" toggle and the broker/consent/disclosure-log in lib/plaintext/ are the access-control model it will use. Don't speculate about transport, and don't state whether a local on-device HTTP API is also planned — that's undecided.

- AI integration. State the boundary that's already decided rather than promising features: on-device inference and on-device fine-tuning work within the E2EE model because the key is already local. Anything server-side — cloud inference, anonymized fine-tuning — requires a separate, explicit, off-by-default opt-in path, never a quiet exception in the sync layer. This is a design commitment worth stating publicly; it's the point of the project.

- Apple sign-in. Currently a disabled row in ManageAccountDialog.tsx, blocked on Apple Developer credentials rather than on any design question.

5. CONTRIBUTING
A CONTRIBUTING.md welcoming community pull requests. Cover: getting the stack running locally (link to the self-hosting docs rather than repeating them), the branch-per-feature convention this project uses, running the verify-*.ts scripts and tsc --noEmit before opening a PR, and what makes a PR easy to review here. Keep it short — a first-time contributor should be able to read the whole thing.

6. REVIEW PASS
Then review everything you wrote as a frustrated beginner who just fought with a badly-documented open-source project would: actually try to follow your own instructions via the terminal on a clean environment where possible, and report exactly where they'd get stuck or give up. Fix what you find.

Note: mvp-build-plan.md is referenced by CLAUDE.md but does not currently exist in the repo. If it's been restored by the time you run this, use it as the source of truth for stage history and roadmap. If it's still missing, flag that rather than reconstructing it from commit messages.
```

---

## Stage 8 — MVP Wrap-Up

**Position:** the app is already running and syncing correctly across **three real devices** (iPad + two Android) from the `live-stack` worktree against PowerSync Cloud + hosted Supabase. So this stage isn't "cut a build," and it isn't "does sync work" either — both are demonstrably true already. It's the adversarial pass on the paths daily use doesn't exercise (fresh install, logout, account switching, key adoption, recovery), the roadmap reckoning, and tagging v0.1.

**This runs against the live remote stack, not localhost.** That's deliberate — simulator-and-local-Docker testing has happened at every prior stage and can't tell you anything new about convergence over a real network, cold-launch lock behavior, or key adoption across genuinely separate hardware. But it means destructive steps hit production data.

**Data safety — the constraint that shapes this stage.** Three steps destroy local data: fresh install (wipes local SQLite; with E2EE there is no server-side plaintext to recover from), logout (`disconnectAndClear()` by design), and cross-device key adoption (re-wraps keys; a wrong-account adoption makes notes undecryptable, and `user_keys` has no UPDATE/DELETE policy — `scripts/repair-shared-account-keys.ts` is **dev-stack only**, so there is no repair path on live). Therefore: **every destructive step runs on throwaway accounts against the live stack.** Remote infrastructure, disposable data. Read-only and additive steps (sync convergence, ciphertext confirmation, stub checks) are safe on the real account.

**Scope decision to make first: web is out of MVP.** Stage 7 published it as unverified, and the blocker is real (PowerSync web needs wa-sqlite/WASM via `@powersync/web`, a different backend from the native op-sqlite path). Either verify it now and keep the original three-platform claim, or drop it from the MVP definition and let the roadmap carry it — but don't leave the plan claiming three platforms while shipping two. Recommend dropping: it's a genuine platform port, not a regression-pass item, and MVP already delivers the local-first + E2EE + sync thesis on mobile.

**Prerequisites:**
- **Create throwaway accounts** for every destructive step (real account's data is already fully synced, so no pre-flight sync check needed).
- **Confirm `live-stack`'s actual gap against `main`.** It was 15 commits behind at one point; it may since have been synced. It's running fine, but "running fine" isn't "current" — check rather than assume, since regression against stale code tests the wrong build.
- **Wake the PowerSync Cloud instance** — free tier deactivates after ~1 week idle; waking from cold may take a few minutes.
- **Re-sign the iPad build if the 7-day window lapsed** (`npm run ios:live` over USB).

**Build:**
- Regression pass on **real iOS and Android hardware**, not simulators.
- **Three-device testing is now possible** — iPad plus two Android on one throwaway account. Convergence, merge, and key adoption tested for real rather than with local SQLite files pretending to be devices. Three is meaningfully better than two here: a third participant catches convergence bugs that two-device tests structurally can't, since with two devices every conflict has an obvious winner.
- Cover the Stage 6/6.5 encryption surface (device lock, recovery code, cross-device key adoption), which didn't exist when this stage was first drafted.
- Verify against the Phase 1 goals honestly: instant-open, usable without login, silent reliable sync, end-to-end encrypted, working self-host docs.
- Confirm the stubs are still *honestly* stubbed on device rather than silently broken.
- Tag v0.1.

**Checkpoint:** all three devices pass the regression list on current `live-stack` code; the real account's notes are intact and verified afterward; every Phase 1 goal is either met or explicitly recorded as not met; `v0.1` tagged on `main`.

**Prompt:**

```
Create a branch `release/v0.1` off main.

The app is already running and syncing correctly across three real devices — an iPad and two Android — from the live-stack worktree (/Users/quan/React/notes-device) against PowerSync Cloud and hosted Supabase. So this isn't a first build, and it isn't "does sync work" either; both are already demonstrably true. This is the adversarial pass on paths daily use doesn't exercise, plus the v0.1 tag. Everything here targets the LIVE REMOTE STACK, not the local Docker dev stack.

=== FRONT-LOAD EVERYTHING THAT NEEDS ME ===

Before running any test, work out the full list of steps in this pass that need my hands or my approval, and get them all done or confirmed in one batch at the start. Do not discover them one at a time mid-run — I will not be watching the whole time, and a run that stalls silently waiting on me wastes the session.

At minimum this includes, and you should add anything else you spot:
- Physical access to all three devices (tapping through flows, toggling airplane mode, deleting and reinstalling the app).
- Email inbox access for the throwaway accounts' OTP sign-in codes — the live stack sends real email, there is no local Inbucket to read them from. Ask me for the addresses to use; do not write them into any committed file, since this repo is public. Suggest Gmail plus-addressing (name+t1@, name+t2@, name+t3@) so one inbox yields as many distinct test identities as the pass needs — confirm Supabase isn't normalising the plus suffix before relying on it.
- Google OAuth consent screens, if any test path uses them.
- PowerSync Cloud dashboard login, if the instance needs waking.
- Re-signing the iPad over USB, if the 7-day window has lapsed.
- My sign-off before the first destructive step on each device.

Present that list to me as one batch, get what you need, and only then start testing. If something genuinely cannot be front-loaded, say so and tell me exactly when in the run it will come up.

=== DATA SAFETY — READ FIRST, THIS GOVERNS EVERYTHING BELOW ===

Three steps in this checklist destroy local data: fresh install, logout (disconnectAndClear by design), and cross-device key adoption. Because the app is end-to-end encrypted there is no server-side plaintext to recover from, and because user_keys has no UPDATE or DELETE policy, a mis-adopted key has no repair path on live — scripts/repair-shared-account-keys.ts is dev-stack only.

Therefore: ALL DESTRUCTIVE STEPS RUN ON THROWAWAY ACCOUNTS created for this pass. Never on my real account. The live remote stack is still the target — real infrastructure, disposable data.

PRE-FLIGHT: create two throwaway accounts on the live stack for this pass, and use them for every destructive step. My real account's notes are already fully synced — don't re-verify that, just proceed.

=== PREREQUISITES ===
- Check live-stack's actual commit gap against main and report it. It was 15 behind at one point and may since have been synced. It's running fine, but running fine isn't the same as current — don't assume either way, and sync it if there's a gap.
- Wake the PowerSync Cloud instance if it has deactivated (free tier sleeps after ~1 week idle; cold wake may take a few minutes).
- Re-sign the iPad build if the 7-day free-personal-team window has lapsed.
- Note: live uses powersync/sync-streams.yaml (Sync Streams ed. 3). sync-rules.yaml is the self-hosted dev config and has no effect here — don't edit the wrong one.

=== SCOPE ===
Web is excluded from this regression pass. Stage 7 already published it as unverified, and the remaining work (PowerSync web needs wa-sqlite/WASM via @powersync/web, not the native op-sqlite path) is a platform port, not a regression item. Confirm the MVP definition and README reflect two platforms shipping with web on the roadmap — don't leave any doc claiming three.

=== REGRESSION CHECKLIST — run across all three physical devices ===

SAFE ON THE REAL ACCOUNT (read-only / additive):
- Instant-open: cold launch lands directly in a note, no loading screen, no login prompt.
- Device-native lock on cold launch and after backgrounding past the timeout.
- Silent sync: create and edit a note, go offline, edit again, reconnect — confirm convergence with no user-facing alert.
- Ciphertext confirmation: query hosted Postgres directly, confirm note title/body are genuine ciphertext.
- Sync issues surface: confirm Settings > Advanced reflects real state and self-clears when resolved.
- Honest stubs on device: Apple sign-in shows unavailable, email change shows its message, trash soft-deletes without a restore surface — each should fail gracefully, not look broken.

THROWAWAY ACCOUNTS ONLY (destructive):
- Fresh install and logged-out path: delete app, reinstall, set up device lock, create and edit notes logged out, kill and relaunch, confirm persistence and instant-open with no login prompt.
- Login and claim: sign in on a throwaway account, confirm pre-login notes are claimed and upload, confirm existing server notes arrive.
- Logout: confirm the unsynced-write warning fires when there is something to lose and not otherwise, and that local SQLite is genuinely empty afterward.
- Three-device convergence and merge: same throwaway account on all three devices, all offline, each editing a different paragraph of the same note, then reconnect them one at a time. Confirm all three edits survive in the final state and that every device converges on identical content. Three participants matter here — with two devices every conflict has an obvious winner, so two-device tests structurally cannot catch ordering bugs where the third merge clobbers an earlier one. Report what each device shows after each reconnect, not just the end state.
- Cross-device key adoption at scale: after adoption on device two, confirm device three also adopts and decrypts correctly — the second adoption onto an account that already has two participants is a different path from the first.
- Cross-device key adoption: sign into the same throwaway account on the second device, confirm existing notes decrypt.
- Recovery code: generation, confirmation step, and that it is account-scoped.
- Key/PIN change re-wraps without re-uploading note content.
- Account isolation: sign out of throwaway A, into throwaway B on the same device, confirm zero rows from A remain readable or claimable.

=== AFTER ===
Re-verify my real account is intact on all three devices — notes present, decrypting, nothing orphaned, still converging. Report this explicitly.

Review the implementation against the Phase 1 goals line by line — instant-open, usable without login, silent reliable sync, end-to-end encrypted, working self-host docs — and report honestly what's met, partially met, or not met. Don't grade generously; an accurate list is more useful than a clean one.

Then tag v0.1 on main once the checklist passes, noting anything that should be fixed before tagging versus filed for later.

Report actual observed results throughout — what happened on each of the three devices, not what should happen.
```

**Roadmap note:** there's no export-all feature — getting notes off a device means sharing them one at a time as plain text. For an app whose pitch is that your notes are genuinely yours, "get all my notes out" is arguably a core capability rather than a nice-to-have, and it's also the thing that would make a pass like this risk-free rather than carefully scoped. Worth considering alongside web and MCP.

---

## Stage 6.5 — Device-Native Lock (supersedes Stage 6's PIN model)

**What actually shipped**, per commit `2634ce9` ("Stage 6.5 Phase 1: device-native lock, PIN and scrypt removed") and confirmed live by the iteration-2 audit:

- `contexts/VaultContext.tsx` + `lib/crypto/` — on-device data key, unlocked by **OS biometric/passcode** (Face ID / Touch ID / device passcode via `expo-local-authentication`) rather than an app-level PIN.
- A wrapped copy of the key is stored server-side (`user_keys`, owner-only RLS), recoverable via a **12-word recovery code** — the WhatsApp-style word list replaced whatever shorter/PIN-based recovery format Stage 6 originally specified.
- `react-native-quick-crypto`/scrypt: fully removed, not just deprecated — not in `package.json`, no dead imports.
- Rationale for the switch (reconstruct from commits/docs if you need the full reasoning — not captured in this plan file): almost certainly the same PIN-entropy problem Stage 6 itself flagged as an accepted risk (“a bare 6-digit PIN is too weak to be an encryption key's only protection”) — device biometrics sidestep that entirely by delegating to the OS's own hardware-backed auth, at the cost of the cross-platform-recovery-code-only path Stage 6 designed around.

**This stage is not documented anywhere else in this plan file** — it exists only in commit messages and the Stage 7 docs pass (`docs/roadmap.md`, `NOTES.md`). If you're planning iteration 2, treat those two files as the actual current spec for the encryption UX, not Stage 6 above.

---

## Decisions Log

Terse, structured, per `CLAUDE.md`'s Compact Instructions format — decision, reasoning, verification, status. Reference by entry name rather than re-summarizing elsewhere in this file.

### 2026-08-20 — Legacy plaintext backfill (closes the metadata-write plaintext leak)
- **Decision:** Added `encryptLegacyPlaintextNotes()` in `lib/powersync/db.ts`, run once from `initPowerSync()` on every app start. Finds any note whose `body`/`title` don't carry the `enc:v1:` envelope prefix and encrypts them in place, deliberately without touching `updated_at`.
- **Reasoning:** Root cause wasn't `trashNoteInDB`/`setNoteHiddenFromApi` individually — PowerSync's connector uploads a row's *entire current local state* on any write, a deliberate Stage 5 design choice that makes retrying a stale queued operation self-healing. Any column left un-migrated (plaintext) locally becomes a leak vector on *any* write to that row, not only ones that touch that column. Patching individual functions would leave every future write path exposed to the same class of bug; a startup backfill closes it structurally, for every path present and future, rather than per call site.
- **Verified:** `scripts/verify-legacy-plaintext-backfill.ts` (local, 9/9) and `scripts/verify-legacy-plaintext-live.ts` (against real dev Postgres, 8/8 — reproduces the original leak end-to-end, confirms genuine ciphertext in Postgres after the fix). `tsc`/lint unchanged (0 errors, same 11 pre-existing warnings, none new).
- **Status:** Branch `fix/legacy-plaintext-backfill`, fully verified, **not yet merged to main** — pending diff review.
- **Consequence accepted:** none — this closes the gap rather than trading it for a new tradeoff.

---

## Known Issues Carried Into Iteration 2

Surfaced by the iteration-2 codebase audit (context-audit skill, run against the live repo) plus subsequent fixes. Ranked by severity, not discovery order.

### ✅ Resolved: plaintext could leak to the server on metadata-only writes
See Decisions Log entry above (2026-08-20) for the fix, reasoning, and verification. **Merge `fix/legacy-plaintext-backfill` to `main` before starting iteration 2 feature work** — it's fixed and verified, but not yet merged.

### Fix before building new features on top of this
- **Merge the plaintext-backfill fix** (above) — the only step left on this item.
- **Trash has no restore/purge UI.** `restoreNoteInDB` and `emptyTrashInDB` (`lib/powersync/db.ts`) are fully implemented and tested at the DB layer, but nothing in the UI calls them — `NoteListPane.tsx`/`NotesLayout.tsx` only ever filter trashed notes *out*. Today, trashing a note is effectively permanent from the user's side. Cheap to fix (backend exists); leaving it will only get more annoying to retrofit once more UI is built around `NotesLayout.tsx`.

### Safe to defer
- Email change, Fonts setting, Android hardware-back verification (coded, never verified — no Android device was in the loop through Stage 8) — low blast radius, no design debt accumulating.
- Apple sign-in — blocked on the $99/yr Apple Developer Program, zero design question outstanding; buying it also fixes the 7-day iOS build-expiry problem, so it's a two-birds purchase whenever you do it.
- `aes-js`/`@noble/ciphers` consolidation (session-blob encryption still uses `aes-js`; note content crypto moved to `@noble/ciphers` in Stage 6) — housekeeping.
- NativeWind preview version (`^5.0.0-preview.4`) — watch for stable release before iteration 2 adds much more UI surface; preview packages can ship breaking changes.
- Web/desktop — genuine separate initiative (see Iteration 2 Roadmap below), don't let it gate mobile-side AI/MCP planning.
- **Dev-stack test accounts have drifted from what's documented** — the plan's `user-a@test.local` wasn't present during the fix verification; `sync-a@test.local` was used instead. Not urgent, but worth a pass to reconcile what test accounts actually exist against what any doc claims, before it causes a confused debugging session.

---

## Iteration 2 — Roadmap Cross-Reference

From `dev-docs/mvp-build-plan.md` Stage 7's roadmap, cross-checked against the live repo (`docs/roadmap.md` agrees):

| Direction | Readiness | Concrete next step |
|---|---|---|
| **Web / desktop** | Entry points exist (`app.json` `web.output: single`, `npm run web`, `components/RichEditor.web.tsx`), genuinely unverified end-to-end — `docs/roadmap.md` says so explicitly. Named blocker: PowerSync's web client needs `@powersync/web` (wa-sqlite/WASM), a different backend from native `op-sqlite`+SQLCipher — at-rest encryption has to be re-solved for it, not just ported. | Spike `@powersync/web` standalone (new branch, no UI work) to find the SQLCipher-equivalent story for WASM SQLite *before* committing UI time. Desktop (Electron/Tauri wrap vs. native) stays undecided until web actually runs. |
| **MCP server / app integrations** | Access-control model fully built and tested: broker (`lib/plaintext/broker.ts`), gates, per-destination consent, audit log (`plaintext_disclosures`), per-note "Visible to Apps" toggle. `lib/plaintext/mcp.ts` is a declared, unimplemented seam — explicitly scoped as "the seam, not the integration," not a blocker. | Pick a transport (local HTTP vs. a stdio MCP server bundled with the app) — explicitly undecided, this is the actual next decision, not implementation work. |
| **AI integration** | Boundary decided and documented (`NOTES.md`, `docs/roadmap.md` §3), zero features built. On-device inference/fine-tuning needs no new plumbing — the key is already in memory post-unlock. | First concrete feature should be on-device-only (semantic search / tagging) to avoid touching the server-side opt-in path at all for v1. The real open question is which on-device inference approach actually runs inside the RN/Expo runtime — most on-device embedding libraries target native mobile SDKs directly, not RN, so this is a real constraint on library choice, not a formality. |
| **Apple sign-in** | Fully blocked on credentials only, zero design question outstanding — email/Google already prove out the same auth path (`lib/auth/oauth.ts`). | Buy the $99/yr Apple Developer Program, wire `expo-apple-authentication` the same way Google is wired. Cheapest, most shovel-ready item on this whole list. |

## Pacing

Stages 4, 5, and 6 will take the longest — Supabase/Postgres/RLS, PowerSync's sync model, and real E2EE are the least familiar and highest-stakes work. Stage 5 is lighter than it looks because the local storage layer already exists and works; it's "connect it," not "build it." Budget Stage 6 generously, especially the recovery-story decision — it's cheap to decide now and expensive to retrofit once real users have data.

Don't skim plans to move faster. The plan and the end-of-task summary are where the learning lives, not the diff. If a summary leaves a step unclear, ask a follow-up in the same session rather than banking the confusion for a later stage built on top of it.
