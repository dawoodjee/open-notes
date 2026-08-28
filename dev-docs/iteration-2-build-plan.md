# Iteration 2 Build Plan — open-notes

**Governs:** iteration 2 only (folders, list view, floating menu chrome, web parity, website, export/import, env toggle). MVP history stays in `dev-docs/mvp-build-plan.md` — don't merge this into it; keep the two files separate so a Claude Code session planning a folder icon doesn't have to read Stage 0–8 and the E2EE Decisions Log first.

**Status (2026-08-23):** Stage 9 ✅ merged · Stage 10 ✅ merged · **Stage 11 ✅ merged to `main`** — every checkpoint item verified except web, which is blocked until Stage 13 (the accent-border rule itself was since confirmed on iPad). **Stage 11.5 ✅ done** — TenTap and the WebView are gone; the editor is native. Spike said NO-GO, Adam overrode it, and a wrap-on-read migration preserved old notes anyway. See `docs/editor-migration-findings.md` plus the Decisions Log. Stage 12, 12.5, 13–16 not started.

> **Stage 11 checkpoint — what was actually verified, and how.**
> - **Date buckets** — unit tests (`npm test`, 86 tests overall) walking every boundary from both sides, including 6-vs-7 days and a future timestamp collapsing into Today.
> - **Pinned section + sync round-trip** — pinned on device, then `select is_pinned from public.notes` on the dev Postgres returned `t`. Server-side, not a local assertion.
> - **Move to All Notes** — `folder_id` confirmed genuinely `NULL` in Postgres after the move.
> - **Swipe** — all four actions fire on **both** platforms via the new `/dev-swipe` harness; real gestures confirmed by hand on Android; capsules measured against `mobile-swipe-left-actions.png` at ~62x44pt.
> - **Select mode, bulk Move/Delete, folder picker** — exercised on device.
> - **Accessibility text sizes** — screenshotted on both platforms. Found and fixed two real clipping bugs: avatar initials overflowing their circle, and the Search field clipping its own placeholder.
> - **⛔ BLOCKED — desktop accent border.** Web does not boot (`Appearance.setColorScheme`), deliberately, until Stage 13. This checkpoint item carries forward to Stage 13 rather than being silently dropped. It is the only unverified item.
> - **Not done: iPad.** Deliberately skipped this pass; it inherits desktop structure and is worth a look when Stage 12 lands.


> ## ▶ NEXT SESSION STARTS HERE (written 2026-08-22, end of the Stage 11 / 11.5 run)
>
> **Position:** `main` @ the Stage 13e merge. Working tree clean. `tsc` clean,
> `npm test` **199/199**, `npx expo lint` 8 warnings / 0 errors. Stages 9, 10,
> 11, 11.5, 12, 12.5, 13a–13e all merged.
>
> **Anything needing Adam's hands now lives in `dev-docs/needs-adam.md`**, with
> the reason I cannot do each one. Four items, one of which (the PowerSync Cloud
> stream) blocks a shipped feature on live devices.
>
> **Decision waiting for Stage 12:** neither `react-native-enriched-html` nor
> markdown can represent **highlight** or **text colour**, and
> `floating-menu/formatting-toolbar-desktop.png` shows both. Stage 12 has to
> drop those two controls or find another route. **Underline is newly available**
> and is already in the toolbar. Stage 12 also loses **indent/outdent** — the
> new editor has no indent API and nested lists flatten to one level.
>
> **Two things that shipped wrong and were caught late — worth remembering:**
> - Force-swipe-to-commit was **dead code** for a whole stage: the row was
>   clamped to the revealed strip while the commit tested a fraction of the ROW
>   width, so the condition could never be true. It read as implemented.
> - `autoCreateIfTrulyEmpty` created **two notes on a fresh device** because it
>   claimed its guard ref after an `await`. Only reproducible on a genuinely
>   empty database.
>   Both are now unit-tested or verified on a wiped device. The pattern in both:
>   *code that reads correct and does nothing.*

**Read alongside:** `dev-docs/mvp-build-plan.md` (Working Practices, CLAUDE.md, historical decisions), `dev-docs/iteration-2-context.md` (live repo state as of 2026-08-20).

**Working Practices:** unchanged from `dev-docs/mvp-build-plan.md` — branch per stage, Plan Mode before non-trivial work, verify over assert, compact at ~60%, escalate expensive/user-visible decisions, log them in this file's own Decisions Log (create one here, don't write iteration-2 decisions into the MVP file).

---

## Screenshot convention

All design references live in the repo at:

```
dev-docs/design/iteration-2/<stage-slug>/...
```

Two shapes are in use, both fine — Folders nests by platform (`folders/desktop/`, `folders/mobile/`), List View prefixes instead (`list-view/desktop-*.png`, `list-view/mobile-*.png`). Don't normalize them; the paths below are verbatim from the repo.

Each stage's `📸 SCREENSHOTS` block marks which files **exist** (✅) versus which are still **needed** (⬜). Claude Code's stage prompt references existing paths directly and `view`s them during Plan Mode — no guessing, no re-uploading mid-session. Commit any missing ones to the branch before starting that stage.

---

## Stage order & why

| # | Stage | Depends on | Why it's here |
|---|---|---|---|
| 9 | UI Foundation Refresh | — | Tokens (text scaling, contrast, motion) every later visual stage builds on. Retrofitting these after Folders/List View ship means redoing both. |
| 10 | Folders | 9 | List View's "All Notes" third row, date-grouping-per-folder, and the floating menu's minimize/restore logic all assume folders exist. |
| 11 | List View (mobile + desktop) | 9, 10 | Needs folder context (All Notes vs. scoped view) before its own row/grouping rules make sense. Removes search/new-note controls from the list — Stage 12 catches them. |
| 11.5 ✅ | Editor migration to `react-native-enriched-html` | 11 | Shipped 2026-08-22. Spike said NO-GO on data preservation; Adam overrode it, and a wrap-on-read migration turned out to preserve old notes rather than escape them. TenTap and the WebView are gone. |
| 12 | Floating Menu Chrome + Formatting Toolbar | 9, 10, 11 | Receives the search/new-note controls Stage 11 removes; its minimize/restore behavior is defined in terms of folder-view and editor-view state from Stage 10. |
| 12.5 | Native sheets + drag-to-reorder folders | 12 | Chrome-level swaps over surfaces Stage 12 has just finished styling. Earlier means restyling twice. |
| 13 (Phase 0) | Web at-rest spike | **none** | Pure investigation, no UI, doesn't touch app code. Runnable any time — and best run early, since a NO-GO changes what later stages need to account for. |
| 13 (Phase 1+) | Web Platform Parity + PWA | 10, 11, 12, Phase 0 | Ports the now-finalized native UI to web rather than building web UI twice. |
| 14 | Website (marketing) | — | Fully independent of the app. Can run in parallel with any stage above on a separate branch. |
| 15 | Export / Import `.md` | 10 (soft) | Needs folder structure only if export preserves it; the parsing/format logic itself has zero UI dependency. |
| 16 | Env file / sign-up toggle | — | Trivial, independent. |

---

## Runnable now

**All stages now have finished prompts.** Stage 12's screenshots are now nearly complete (rescanned 2026-08-21) — only the mobile scrolling-bar *collapsed* state is still missing — and the prompt's Apple Notes fallback covers that one gap.

Suggested parallelism: Stage 9 in the app repo, the Stage 13 spike on its own branch, and Stage 14 in the new website repo can all run without colliding. Stages 10 → 11 → 12 are strictly sequential.

---

## Stage 9 — UI Foundation Refresh ✅ MERGED

Establishes shared primitives every later stage reuses: no rebuild needed once Folders/List View/Menu chrome start consuming them.

- Text-bearing components (menus, search bar, list rows, dialogs) scale with OS text size setting.
- Contrast audit: no element uses pure white or pure black anywhere in the app.
- Apple-style hover/press/transition primitives (spring curves, durations, easing) as reusable tokens/utilities, not per-component one-offs.

**📸 SCREENSHOTS** *(optional — this stage is mostly systemic, not screen-specific)*
- `dev-docs/design/iteration-2/foundation/transition-reference.png` — only if you have a reference clip/still of the Apple-style motion feel you want matched.

**Learn:** RN's text-scaling model (`allowFontScaling`, Dynamic Type on iOS vs. font-scale on Android), why hex-literal color values defeat theming, spring-vs-duration animation config in RN's Animated/Reanimated.

**Checkpoint:** every text-bearing component visibly scales when OS text size is increased (verified on simulator, not asserted); a repo-wide grep for pure white/black hex or named values returns zero hits outside intentional exceptions (documented if any exist); a shared motion-primitives module exists and at least one real interactive element (e.g. list row press, button tap) visibly uses it.

**Prompt:**

```
Create a branch `stage-9-ui-foundation` off main; merge back once the checkpoint passes.

CONTEXT: This is the first stage of iteration 2. MVP (Stages 0–8) and Stage 6.5 are merged to main — see dev-docs/mvp-build-plan.md for full history, but you shouldn't need it for this stage. This stage's job is establishing shared UI primitives that Stages 10–12 (Folders, List View, Floating Menu Chrome) will build on — it deliberately does NOT touch those features' actual screens. Read the apple-design-system skill before proposing any token structure or motion feel — it's already set up in this project and should govern the direction here, not a from-scratch design pass. There are no reference screenshots for this stage; use the skill's guidance and your own judgment on Apple-style feel, and flag in your plan anywhere you're making a stylistic call you're not fully confident in.

SCOPE — three independent sweeps, but do them in this order since #3 benefits from #1/#2 being settled first:

1. TEXT SCALING
Audit every text-bearing component (list rows, menus, search bar, dialogs, buttons, labels, nav bar titles) for whether it actually respects the OS text-size setting. Specifically check for:
- Any `allowFontScaling={false}` (or NativeWind/Gluestack equivalents) that's silently blocking scaling — remove unless there's a real reason to keep it, and if you find one, tell me rather than deciding silently.
- Any fixed pixel font sizes defined in a way that doesn't respond to the system setting.
- Whether layouts break (truncation, overlap, clipping) at larger accessibility text sizes — note any that do, fix the cheap ones now, flag structural ones for me rather than doing a deep layout rework in this stage.
Verify by booting the simulator, setting iOS text size to at least one accessibility-range step above default (Settings > Accessibility > Display & Text Size > Larger Text) and Android's font scale similarly, then screenshotting the app's main screens at that setting. Show me the screenshots.

2. CONTRAST AUDIT
Grep the codebase for pure white / pure black — hex literals (#fff, #FFFFFF, #000, #000000), named values (white, black), and any theme tokens currently defined as pure values. Replace with near-white/near-black tokens consistent with iOS system color conventions (e.g. systemBackground vs. literal white, label vs. literal black) rather than picking arbitrary off-shades — check what the apple-design-system skill specifies here before inventing values. Define these as named tokens in the theme config, not as scattered inline replacements, so anything built in later stages inherits them automatically. Report the full list of what you changed and where, plus confirm the grep now returns zero hits outside any documented, justified exception.

3. MOTION PRIMITIVES
Create a shared motion-primitives module (propose a location — likely something like `lib/theme/motion.ts` — and confirm it during Plan Mode) defining reusable spring/duration configs matching Apple's characteristic feel: press/tap feedback, expand/collapse, and a general-purpose transition curve. Pull the specific spring parameters (damping, stiffness, mass) and duration/easing values from the apple-design-system skill rather than guessing at "Apple-ish" numbers. These primitives are consumed by Stages 10–12 later (folder collapse, list transitions, menu expand/collapse) — this stage only has to define them well and prove them out, not apply them everywhere. As proof of adoption, apply the primitives to at least one existing interactive element already in the app (e.g. list row press state, a button) and confirm it visibly uses the new spring/duration rather than whatever ad hoc animation was there before.

OUT OF SCOPE — don't restructure Folders, List View, or menu components beyond trivial token swaps if you happen to touch them; those are separate stages with their own screenshots and specs coming later. If applying a token forces a larger structural change to hit cleanly, stop and tell me rather than expanding scope.

VERIFY: Report the text-scaling screenshots (default size + accessibility size), the full grep-audit diff for the contrast sweep, and confirm via a quick demo (screen recording or before/after screenshot) that the motion module is real and applied somewhere, not just defined and unused. tsc --noEmit and lint clean, same as every prior stage.
```

---

## Stage 10 — Folders ✅ MERGED

**Settled decisions** (see Decisions Log for reasoning): folder names are encrypted like note titles · one folder per note · reordering is top-level only · Group By Date is a per-folder setting · "Include in Notes" off excludes from All Notes but **not** from search · Recently Deleted auto-clears after 30 days · **Recently Deleted is also the fix for the long-standing missing trash restore/purge UI** — the DB functions (`restoreNoteInDB`, `emptyTrashInDB`) already exist and are tested, nothing calls them yet.

- Default folders: **All Notes** (first), **Skills** (second, reorderable), **Recently Deleted** (always last, not reorderable).
- **Skills** holds AI skills the app or connected apps will consume. In this stage it's the folder and its behavior only — no skill parsing, execution, or app-facing plumbing; that's later work.
- Note count at the right end of each folder row.
- New Folder icon + collapse button at the top of the folder list; new folders insert after Skills.
- Hierarchy: 5 layers total — the top-level folder plus 4 nested sub-folder levels beneath it.
- Slightly smaller icon size for sub-folders vs. top-level.
- Selecting a folder shows all its children's notes.
- Collapsible folders: chevron left-pointing when closed, down when open.
- Context menu (long-press mobile / right-click desktop and iPad): Include in Notes toggle (on by default except Recently Deleted; off by default for Skills) → Rename (hidden for all default folders) → separator → New Folder → Group By Date → separator → Delete Folder (quiet if empty, warning modal if it has notes — notes move to Recently Deleted).

**📸 SCREENSHOTS** — all present, both platforms ✅

`dev-docs/design/iteration-2/folders/desktop/` and `.../folders/mobile/`, same six filenames in each:
- `sidebar-default-state.png`
- `sidebar-expanded-subfolder.png`
- `context-menu.png`
- `delete-warning-modal.png`
- `new-folder-collapse-icons.png`
- `subfolder-icon-sizing.png`

✅ iPad: `dev-docs/design/iteration-2/folders/ipad/` (added 2026-08-21, review round 2)
- `ipad-portrait-default-view.jpeg` — list + editor; reveal icon INLINE with the title, `(...)` at the right
- `ipad-portrait-folder-view.jpeg` — the folder panel as a floating inset card over the content, NOT a takeover
- `ipad-landscape-default-view.jpeg` — same header, sidebar hidden
- `ipad-landscape-folder-view.jpeg` — folder panel as a real third pane; its header is `Edit` (left) · new-folder · collapse (right)

These are what established that the header shape and the folder pane's presentation are INDEPENDENT — iPad portrait wants the wide header with an overlay panel, a combination a single flag could not express. See the Decisions Log entry below.

**Learn:** modeling recursive hierarchies in SQL (adjacency list vs. alternatives), why encrypted columns can't participate in server-side filters, cascade semantics on delete.

**Checkpoint:** folders create/rename/delete/nest to 5 levels and survive app restart; a direct Postgres query shows folder names as genuine ciphertext; notes move between folders and the counts stay correct; deleting a folder with notes moves them to Recently Deleted rather than destroying them; Recently Deleted restores and purges from the UI; the 30-day sweep is proven with a back-dated row, not asserted.

**Prompt:**

```
Create a branch `stage-10-folders` off main; merge back once the checkpoint passes.

CONTEXT: Iteration 2, second stage. Stage 9 (UI foundation — text scaling, contrast tokens, motion primitives) is merged; use its tokens and motion primitives rather than defining new ones. Read the apple-design-system skill before proposing UI. Design references are in the repo — view them during Plan Mode, they are authoritative over my prose description:
  dev-docs/design/iteration-2/folders/desktop/{sidebar-default-state,sidebar-expanded-subfolder,context-menu,delete-warning-modal,new-folder-collapse-icons,subfolder-icon-sizing}.png
  dev-docs/design/iteration-2/folders/mobile/  — same six filenames
There are no iPad screenshots; see the iPad section below.

=== DATA MODEL — escalate before implementing ===

Folders are a new synced table. Before writing any migration, propose the schema and stop for my review. Specifics already decided, don't relitigate these:

- Folder NAMES ARE ENCRYPTED, treated exactly like note title/body: same client-side AES-GCM path via @noble/ciphers, same `enc:v1:` envelope. A folder called "Therapy" leaks as much as a note title, and shipping it plaintext beside encrypted note bodies would contradict the project's stated guarantee. Structural columns — id, parent_id, user_id, sort order, timestamps, a default-folder type flag — stay plaintext so RLS and sync filtering still work, mirroring the existing note-row split.
- Because names aren't server-readable, default folders must be identified by a STABLE PLAINTEXT TYPE FLAG, never by matching on name. Otherwise "Recently Deleted" can't be reliably pinned last, and localizing names later would break it.
- ONE FOLDER PER NOTE. A single nullable folder reference on the note, not a join table.
- Hierarchy is 5 layers total: top-level plus 4 nested levels. Enforce the depth limit — decide where (DB constraint vs. app-level check) and tell me which and why.

- "ALL NOTES" AND "RECENTLY DELETED" ARE VIRTUAL VIEWS, not folder rows. All Notes is "every note, subject to the Include-in-Notes filter"; Recently Deleted is already fully expressible over the existing is_trashed/trashed_at columns. Making either a real row would duplicate state that already exists and create two sources of truth for trash. SKILLS IS THE ONLY REAL DEFAULT FOLDER ROW. Seed it.
- PER-FOLDER GROUP BY DATE AND FOLDER SORT ORDER ARE SYNCED COLUMNS, not local ui_state. A user who groups a folder by date on their iPad should see it grouped on their phone. Both are structural, not content, so they stay plaintext.

Also required: sync rules for the new table in BOTH powersync/sync-rules.yaml (bucket_definitions, self-hosted) and powersync/sync-streams.yaml (Cloud, Sync Streams ed. 3). They are different formats and both are real — editing only one produces a confusing partial failure. Owner-only RLS, same shape as the notes table.

=== BEHAVIOR ===

Default folders: All Notes first, Skills second (reorderable by the user), Recently Deleted always last and never reorderable. New user-created folders insert after Skills.

SKILLS FOLDER: this will hold AI skills that the app or connected apps consume. In THIS stage, build only the folder and its behavior — creating it, its default state, its context-menu differences. No skill parsing, no execution, no app-facing plumbing; that lands in later work. Its "Include in Notes" defaults OFF (skills shouldn't clutter the notes list); every other folder defaults ON, and Recently Deleted has no such toggle at all.

Notes inside Skills DEFAULT TO "VISIBLE TO APPS" ON, unlike every other note in the app, which defaults off. This is deliberate: a skill that connected apps can't read is useless, so the folder carries the intent. Wire this to the EXISTING per-note api_visible flag and the lib/plaintext/ broker — do not add a parallel mechanism or bypass the broker. The per-note toggle must still work normally inside Skills: a user can turn an individual skill's visibility off, and moving a note out of Skills must not silently flip its visibility. Since this changes a security-relevant default, state plainly in your summary what the resulting behavior is on every path — note created in Skills, note moved into Skills, note moved out of Skills.

"INCLUDE IN NOTES" SEMANTICS: when off, that folder's notes are excluded from the All Notes list ONLY. They still appear in search results. Don't extend the exclusion to search.

Note count at the right end of every folder row. Decide and state whether a parent's count includes descendants' notes — and make it consistent with the fact that selecting a folder shows all its children's notes.

Reordering: TOP-LEVEL FOLDERS ONLY in this stage. No re-parenting by drag, no dragging notes into folders — both are deliberately out of scope, don't build them speculatively.

Collapsible folders with a chevron: pointing left/right toward the folder when closed, down when open. Sub-folder icons render slightly smaller than top-level.

Context menu, per the screenshots (long-press on mobile; right-click on desktop AND iPad):
  Include in Notes (eye/closed-eye icon, toggle) — absent for Recently Deleted
  Rename (pen icon) — hidden for all three default folders
  --- separator
  New Folder
  Group By Date (calendar icon) — a PER-FOLDER setting, each folder remembers its own, not one global toggle
  --- separator
  Delete Folder (trash icon)

Delete Folder: silent if the folder is empty; if it has notes or subfolders, show the warning modal from delete-warning-modal.png — "Delete this folder?" / "All notes and any subfolders will be deleted." Deleted notes go to Recently Deleted, they are NOT destroyed. Confirm the same holds for notes inside nested subfolders.

=== RECENTLY DELETED — this also closes an existing gap ===

restoreNoteInDB and emptyTrashInDB in lib/powersync/db.ts are already implemented and tested, but NOTHING IN THE UI CALLS THEM — trashing a note is currently permanent from the user's side. Recently Deleted is the surface that fixes this: opening it lists trashed notes, with restore and empty-trash actions wired to those existing functions. Don't reimplement them.

Auto-purge after 30 days. Decide the trigger (a sweep at app start is the obvious candidate, consistent with how encryptLegacyPlaintextNotes already runs from initPowerSync) and tell me your choice. Since the app is end-to-end encrypted, purge has to be client-driven — the server can't evaluate note age against content it can't read, though it can read trashed_at, so say whether you're relying on that and what happens for a user whose second device hasn't opened in months.

=== iPAD ===
No iPad screenshots exist. iPad inherits the DESKTOP structure but stays touch-first:
- Folder sidebar is a persistent split-view pane in landscape, collapsing to an overlay in portrait.
- Touch affordances (swipe, press-and-hold) are kept even with a Magic Keyboard attached — hover-only affordances are a bug on iPad, not graceful degradation.
- EXCEPTION: folder and list-view menus follow the desktop treatment (persistent / right-click-capable) rather than the mobile long-press action sheet.

=== OUT OF SCOPE ===
List-view changes (date grouping in the list, pinned section, select mode, third row) are Stage 11 — they have their own screenshots and spec. Touch NotesLayout.tsx/NoteListPane.tsx only as far as folder selection requires. If folder work forces a structural change to the list components, stop and tell me rather than starting Stage 11 early.

=== VERIFY ===
Prove, don't assert:
- Create a 5-level nested structure; confirm the 6th level is actually refused.
- Query Postgres directly and show folder names are genuine ciphertext, not plaintext.
- Confirm a second test account cannot read the first's folder rows (RLS).
- Delete a folder containing notes AND a subfolder containing notes; confirm every affected note lands in Recently Deleted and none are destroyed.
- Restore a note from Recently Deleted and confirm it returns to its original folder.
- Prove the 30-day purge with a back-dated trashed_at row rather than describing it.
- Confirm "Include in Notes" off hides notes from All Notes but they still surface in search.
- Screenshot the folder sidebar on iOS and Android at default and at an accessibility text size (Stage 9's scaling must still hold).
- tsc --noEmit and lint clean.
```

---

## Stage 11 — List View (Mobile + iPad + Desktop) 🔄 IN PROGRESS

> **Standing iPad rules for Stages 10–12** (apply wherever no iPad screenshot exists): iPad inherits the **desktop layout's structure** — same panes, same grouping, same information density — but stays **primarily touch-driven**, not a scaled-down desktop. Decided:
> - **Folder sidebar:** persistent split-view pane in landscape; collapses to an overlay in portrait.
> - **Touch affordances are kept, not replaced** — swipe actions and press-and-hold remain even with a Magic Keyboard attached. Hover-only affordances are a bug on iPad; anything desktop reveals on hover needs a tap or press-and-hold equivalent.
> - **"Aa" is pinned to the top nav bar on iPad**, matching desktop's persistent placement rather than the phone's keyboard-adjacent bar.
> - **Folder and list-view menus follow the desktop treatment** — persistent / right-click-capable — rather than the mobile long-press action sheet. This is the one deliberate exception to the touch-first rule.
>
> Use judgment on anything not covered; flag calls you're unsure about during Plan Mode rather than deciding silently.

> ⚠️ **Icon buttons: build them locally here — the shared primitive is Stage 12's, by decision.** Stage 11 introduces a **circular Done button**, **floating pill buttons** for bulk Move/Delete, and a **row of filled icons** in the context menu, which are the same circle / capsule / accent-circle shapes Stage 12's icon-button system defines. **Decided 2026-08-21 (review 4): the primitive lands in Stage 12**, alongside the rest of the menu-chrome work, *not* here.
>
> So in this stage: build these three to match `dev-docs/design/iteration-2/floating-menu/icon-buttons-*.png` as closely as you can, but **keep them local and easy to replace** — no clever abstraction, no half-primitive that Stage 12 then has to argue with. **Do not modify `HeaderCircleButton` or `PressableScale`.** List every icon button you add in your summary, with file and line, so Stage 12 has an exact conversion list instead of re-auditing the tree. Expect these to be rewritten; that is the accepted trade, not an accident.

- Pinned notes get their own section at the top of the list. **Pin state syncs across devices.**
- Group By Date, Apple Notes style — Today / Yesterday / Previous 7 Days / Previous 30 Days / month / year buckets.
- Third row (folder name + icon) shown per note when viewing All Notes.
- **Desktop:** bold titles; only the currently-open note gets an OS-accent-colored rounded border; every other note (and active date-group labels) gets a bottom separator line where a next item exists; date-group label and its separator align slightly left; search bar and New Note button are removed from the list pane (Stage 12 relocates them).
- **Mobile:** Apple Notes-style navigation (back/left-chevron to parent, tap-through into folders/notes); default view is last-viewed note or list; third row same as desktop; swipeable rows — swipe right previews Pin then commits further right, swipe left previews Share/Move/Delete.
- Context menu (long-press mobile / right-click desktop and iPad): top row of filled icons with text underneath — Share, Move, Delete — separator — Pin, Duplicate.
- **Select Notes (multi-select mode)**, matching Apple Notes on both platforms — see `select-notes-in-list-view.png`, authoritative for layout:
  - Large title becomes the live count (**"3 Selected"**) with total note count as a subtitle beneath ("45 Notes"); a circular confirm/done button top-right exits the mode.
  - Selected rows get a filled accent-colored checkmark circle at the left plus a tinted row background; unselected rows show an empty outline circle.
  - Date grouping and the folder-name third row remain visible and behave normally — selection is an overlay on the existing row, not a different row component.
  - Bulk actions sit in **floating pill buttons docked at the bottom**, over the scrolling list. Apple's set is Move / Tags / Delete; **this app ships two pills — Move and Delete.** Tags is iteration 3; don't substitute another action into the empty slot, lay out for two.
  - **Bulk Move opens a folder picker.** **Bulk Delete requires a confirmation.**
- **Three separate Move entry points, one shared picker:** swipe-left, the context menu, and bulk select mode all live in this stage; a fourth entry point (the note editor's own `…` menu) belongs to Stage 12 and calls the same picker component this stage builds. The picker itself is a modal sheet on mobile/iPad and a nested right-click flyout on desktop — not the same shape on both.
- **Media thumbnails are omitted** — they appear in the Apple reference screenshots, but multimedia is iteration 3. Don't build the slot.

**📸 SCREENSHOTS** — under `dev-docs/design/iteration-2/list-view/`, all present ✅
- `desktop-selected-note-border.png`
- `desktop-date-group-separator.png`
- `desktop-all-notes-third-row.png`
- `desktop-context-menu.png`
- `mobile-all-notes-third-row.png`
- `mobile-press-and-hold-note-context-menu.png`
- `mobile-swipe-right-pin.png`
- `mobile-swipe-left-actions.png`
- `mobile-swipe-left-actions-2.png`
- `pinned-section.png`
- `select-notes-in-list-view.png`

**Move/folder-picker shots** — added 2026-08-21, all ✅ present, covering three separate Move entry points plus the picker itself on every platform:
- `desktop-move-folder-selection.png` — right-click → **"Move to" flyout submenu**, nested (iCloud/On My Mac split, then a live indented tree — child folders shown nested under their parent, greyed where selecting would be a no-op).
- `ipad-move-folder-selection.png` — **modal "Select a Folder" sheet**, not a flyout. `New Folder` pinned first, then a flat top-level list, then nested folders as their own **expandable disclosure rows** (chevron per folder, not permanently expanded). The note's current folder is greyed and inert — can't move it into itself.
- `mobile-move-note-folder-picker.png` — same "Select a Folder" sheet pattern as iPad, dark mode. Shot happens to come from a top-level note, so no nested rows are visible in it — **treat `ipad-move-folder-selection.png` as the authority for how nesting renders**, not this one.
- `mobile-move-left-swiped-note-option.png` — a **PARTIAL** swipe-left, showing only **Move** and **Delete**. Do not read this as the full action set: `mobile-swipe-left-actions.png` and `-2.png` show the same gesture dragged all the way, and there are **three** actions — **Share** (blue), **Move** (indigo), **Delete** (red), each a capsule with its label beneath. Share is simply still off-screen in the partial shot.
  - Corrected 2026-08-21 during Stage 11, after this file briefly recorded the opposite. "It's the same, I just didn't swipe all the way" means the same *state* at a shorter drag — **not** that only two actions exist. Built as two, caught in review. The lesson generalises: a partially-revealed control is not evidence of what it fully reveals.
- `mobile-move-selected-notes-to-folder-from-list-view.png` — select mode's bulk **Move** pill triggering the same picker sheet. Confirms the picker is shared across the bulk and single-note paths, as already planned.
- `mobile-move-to-folder-from-note-editor-menu.png` — **third entry point, and it's not List View's:** the note editor's own `…` menu has a **"Move Note"** row (alongside Find in Note, Recent Notes, etc. — most of that menu is Stage 12/Floating-Menu-Chrome territory, not this stage). Stage 11's job is the folder-picker **component** and the swipe/select entry points; wiring this third entry point is Stage 12's, once the editor's `…` menu exists. Flagged in Stage 12 below.
- `ipad-move-context-menu.png` — iPad's press-and-hold/right-click note menu: same **icon-row-plus-list** shape as `desktop-context-menu.png` (Share/Move/Delete icons up top), but the list below adds **Open in New Window** and **Lock** — both Apple features this app doesn't have (no multi-window on iPad, no note-locking feature). Build the list as **Pin → Duplicate** per the existing plan; don't add Lock or Open in New Window.

**Learn:** sectioned/grouped list rendering in RN, gesture handling and swipe thresholds, selection state that doesn't fight a reactive query-backed list.

**Checkpoint:** date grouping matches Apple's buckets; pinned section renders and pin state survives a sync round-trip to a second device; swipe gestures work on both mobile platforms with correct preview-vs-commit thresholds; select mode's count updates live and bulk Move/Delete both work with picker and confirmation respectively; desktop shows the accent border on the current note only.

**Prompt:**

```
Create a branch `stage-11-list-view` off main; merge back once the checkpoint passes.

CONTEXT: Stage 9 (UI foundation) and Stage 10 (Folders) are merged — use Stage 9's motion primitives and color tokens, and Stage 10's folder model rather than introducing anything parallel. Read the apple-design-system skill before proposing UI. Design references are in the repo and are authoritative over my prose — view them during Plan Mode:
  dev-docs/design/iteration-2/list-view/desktop-{selected-note-border,date-group-separator,all-notes-third-row,context-menu}.png
  dev-docs/design/iteration-2/list-view/mobile-{all-notes-third-row,press-and-hold-note-context-menu,swipe-right-pin,swipe-left-actions,swipe-left-actions-2}.png
  dev-docs/design/iteration-2/list-view/pinned-section.png
  dev-docs/design/iteration-2/list-view/select-notes-in-list-view.png

Note: the Apple reference screenshots show media thumbnails at the right end of rows. DO NOT BUILD THOSE — multimedia is iteration 3. Don't reserve the slot either.

ICON BUTTONS — READ THIS BEFORE BUILDING THE DONE BUTTON, THE BULK-ACTION PILLS, OR THE CONTEXT-MENU ICON ROW.
Those three are the same shapes Stage 12's "icon-button system" defines, but THE SHARED PRIMITIVE IS STAGE 12'S BY DECISION — do not build it here, and do not touch HeaderCircleButton or PressableScale.
Build these three LOCALLY and keep them dumb and easy to delete. Match dev-docs/design/iteration-2/floating-menu/icon-buttons-{groups-light,groups-dark,editor-accent}.png — view them during Plan Mode.
Shapes to copy: one icon = circle; 2+ RELATED icons = a single capsule (grouping is semantic, not spatial — in the accent shot Undo keeps its own circle right beside a Share/overflow capsule); confirm action = filled accent circle standing alone, which is what the select-mode Done button should look like.
Also: painted size is SMALLER than the touch target — paint to match the reference and restore >=44pt with hitSlop. Do not paint a 44pt circle.
IN YOUR SUMMARY: list every icon button you added with file:line. Stage 12 uses that as its conversion list.

=== SHARED BEHAVIOR (all platforms) ===

DATE GROUPING, Apple Notes style: Today / Yesterday / Previous 7 Days / Previous 30 Days / then by month, then by year for older notes. This is toggled per-folder (Stage 10 built the setting) — respect that setting rather than adding a second global one.

PINNED NOTES: own section at the top of the list, above the first date group. PIN STATE SYNCS ACROSS DEVICES — it's a new synced column on the note. Per the project's encryption split, pin is a boolean structural flag, not user content, so it stays plaintext like is_trashed; confirm that's how you've modeled it. Users can pin and unpin; reordering within the pinned section is out of scope.

THIRD ROW: when viewing All Notes, each row shows a third line with the note's folder name and a folder icon. Folder names are encrypted (Stage 10), so this renders from decrypted local data — confirm there's no path where it would require a server-side lookup.

=== DESKTOP ===
- Note titles bold.
- ONLY the currently-open note gets a rounded border in the OS accent color. Every other row gets a bottom separator line, but only where a next item exists — no trailing separator at the end of a group or list.
- Date-group labels and their bottom separators align slightly LEFT of the row content, per desktop-date-group-separator.png.
- REMOVE the search bar and New Note button from the list pane. Stage 12 relocates them into the editor chrome. This will leave a gap in the layout — that's expected and correct, not something to fill.
- Context menu on right-click, per desktop-context-menu.png. Move's own submenu is a NESTED FLYOUT per desktop-move-folder-selection.png — iCloud/On My Mac split, then a live indented tree with the note's current folder greyed out.

=== MOBILE ===
- Apple Notes-style navigation: back button with a left chevron to the parent, tap through folders and rows to descend. Default view on launch remains last-viewed note or the list, matching existing instant-open behavior — don't regress that.
- SWIPEABLE ROWS. Swipe right: reveals Pin as a preview, committing when swiped further. Swipe left reveals THREE actions — Share (blue), Move (indigo), Delete (red) — per mobile-swipe-left-actions.png/-2.png. mobile-move-left-swiped-note-option.png is a partial swipe of the same gesture with Share still off-screen; don't build from it alone. Get the two-stage threshold right — a short swipe reveals, a long swipe commits — and note that the left side reveals three buttons, so its commit threshold has to sit well past the point where all three are visible or "look at Share" and "delete this" become one gesture. Use Stage 9's spring primitives for the return animation.
- Press-and-hold opens the context menu, per mobile-press-and-hold-note-context-menu.png: a top row of filled icons with text labels beneath — Share, Move, Delete — then a separator, then Pin and Duplicate. The hold duration must be LONGER than the drag/swipe threshold so the two gestures don't fight each other; state what you used.
- A THIRD Move entry point exists but is NOT this stage's to wire: the note editor's own "..." menu has a "Move Note" row, per mobile-move-to-folder-from-note-editor-menu.png. That menu belongs to Stage 12 (Floating Menu Chrome). Build the folder-picker component so Stage 12 can call it from there — don't build the editor menu itself.

=== SELECT NOTES (multi-select) ===
Per select-notes-in-list-view.png, on all platforms:
- The large title becomes a live count — "3 Selected" — with the total note count as a subtitle beneath it ("45 Notes"). A circular confirm/check button sits top-right to exit.
- Selected rows: filled accent-colored checkmark circle at the left edge plus a tinted row background. Unselected: empty outline circle, normal background. Selection is an OVERLAY on the existing row component — don't build a second row component for select mode.
- Date grouping and the folder third row keep working normally while selecting.
- Bulk actions are FLOATING PILL BUTTONS docked at the bottom, over the scrolling list — not a solid docked toolbar. Apple shows Move / Tags / Delete; THIS APP SHIPS TWO: Move and Delete. Tags is an iteration-3 feature and is deliberately absent — do not substitute another action into the slot, and lay the pills out for two rather than centering a gap.
- Bulk MOVE opens a folder picker. Bulk DELETE requires a confirmation. (Single-note delete keeps its existing silent, recoverable trash behavior — only the bulk path confirms.)
- Propose the entry point (list menu vs. long-press vs. both) from what the screenshots show, and say which you chose.

FOLDER PICKER: needed by bulk Move, single-note Move (swipe + context menu), AND Stage 12's future editor-menu entry point — build it once, as a component the other call sites reuse rather than three separate implementations. References now exist per platform: mobile-move-note-folder-picker.png (mobile, flat — no nested rows visible in the shot itself), ipad-move-folder-selection.png (the modal "Select a Folder" sheet with expandable disclosure rows per subfolder — treat THIS as authoritative for how nesting renders on mobile too, since the mobile shot didn't happen to include a nested folder), desktop-move-folder-selection.png (a right-click flyout submenu, structurally different from the modal sheet — desktop does NOT get a modal, it gets the nested flyout). "New Folder" is pinned first in the sheet variant. The note's current folder is greyed out and inert in every shot — can't move a note into the folder it's already in.

=== iPAD ===
Inherits the DESKTOP structure but touch-first: swipe actions and press-and-hold are KEPT even with a Magic Keyboard attached, hit targets stay >=44px, and no affordance may be hover-only. Exception: the list-view MENU follows the desktop treatment (persistent / right-click-capable) rather than the mobile action sheet. The folder sidebar from Stage 10 is a split-view pane in landscape, an overlay in portrait.
Context menu per ipad-move-context-menu.png: same icon-row-plus-list shape as desktop-context-menu.png (Share/Move/Delete icons on top). The reference list below also shows "Open in New Window" and "Lock" — SKIP BOTH, this app has no iPad multi-window and no note-locking feature. Build Pin then Duplicate below the separator, matching the already-decided desktop/mobile list, not the extra Apple-only rows.

=== VERIFY ===
- Date buckets: seed notes with back-dated timestamps spanning today, yesterday, 5 days, 20 days, 3 months, and 2 years, and screenshot the resulting grouping. Don't assert the buckets are right, show them.
- Pin sync: pin on one device/session, confirm it appears pinned on a second — a real round trip, not a local-only assertion.
- Bulk delete a multi-note selection and confirm every note lands in Recently Deleted, none destroyed.
- Bulk move a selection and confirm the folder counts update correctly on both source and destination.
- Confirm swipe and press-and-hold don't trigger each other; state the thresholds.
- Confirm removing the search bar and New Note button from the desktop list pane didn't break any existing entry point to creating a note — if it did, say so; Stage 12 restores it, but I need to know the gap exists.
- Screenshot list view on iOS and Android at default and at an accessibility text size.
- tsc --noEmit and lint clean.
```

---

## Stage 11.5 — Editor migration to `react-native-enriched-html` ✅ DONE (2026-08-22)

> **✅ OUTCOME: SHIPPED.** The Phase 0 spike recommended NO-GO on
> data-preservation grounds. **Adam overrode that deliberately** — backwards
> compatibility was not worth blocking on, and what matters is that new notes
> work well. That was the right call, and it changed the question from "can
> this preserve everything?" to "can old notes survive readably?", which has a
> much better answer than the fallbacks offered (a code block, or escaped HTML).
>
> **`lib/notes/htmlMigrate.ts`** converts a legacy body on read and encodes the
> two parser rules the spike measured:
> 1. `setValue()` decides HTML-vs-plain-text by **input string length** and
>    escapes anything ≤ ~12 characters into visible markup. Wrapping in
>    `<html>…</html>` adds 14 characters and clears that for every possible
>    document — including a brand-new empty note, which is why it is applied
>    unconditionally rather than only when it looks needed.
> 2. Once wrapped it understands `<b>`/`<i>` but **silently drops**
>    `<strong>`/`<em>`, which is exactly what TenTap emitted. Converted before
>    wrapping.
>
> It is **idempotent**, verified on device and in tests, so it sits on the read
> path without the document drifting on every open.
>
> **Survives:** headings, `<u>`, `<s>`, `<code>`, links, lists, blockquotes.
> **Lost, accepted:** nested lists flatten to one level; task-list checked
> state; `<pre><code>` becomes the library's non-standard `<codeblock>`.
>
> **Removed:** `@10play/tentap-editor`, `react-native-webview`, the `react-dom`
> 18-vs-19 override, two dead `RichEditor` files, and a babel alias pointing at
> a file that does not exist. Lint warnings 11 → 8.
>
> **Honest caveat:** tiptap does not fully disappear —
> `react-native-enriched-html` depends on it for its own **web** build. On
> native there is no tiptap and no WebView, which is the part that was slow.
>
> **Stage 12 consequence:** neither this library nor markdown can represent
> **highlight** or **text colour**, both of which appear in
> `formatting-toolbar-desktop.png`. Stage 12's toolbar has to drop those two
> controls or find another way. Underline, which TenTap could not do, is now
> available and is in the toolbar.

**Why this was proposed and why it was HERE.** Stage 12 builds a formatting toolbar and
Find/Replace that talk directly to the editor's bridge API. Building those against
TenTap and then swapping the editor underneath means writing them twice. So the swap
goes first.

**What changes:** `@10play/tentap-editor` (a ProseMirror editor inside a WebView) is
replaced by `react-native-enriched-html` v1.1.1 — Software Mansion's **native** rich
text input. Same content format: HTML in, HTML out, so **no note bodies move**.

**Why HTML and not markdown** — this was the real question, and the screenshots
answered it. `floating-menu/formatting-toolbar-desktop.png` and
`floating-menu/mobile-navbar-default-aa-undo-redo.png` show **underline**, **highlight**
(visibly applied to "THEME:" in the mobile shot) and **text colour**. None of the three
exist in CommonMark or GFM. Storing markdown would silently drop formatting controls the
authoritative references show. `react-native-enriched-markdown` is otherwise a fine
library — it is simply the wrong format for this app. And `react-native-streamdown` is a
read-only *streaming renderer* for AI chat output; it has no input at all and was never a
candidate. See the Decisions Log.

**Editing stays always-on.** No view/edit mode split. Apple Notes has none, every
reference screenshot shows a live editor, and Stage 12's whole design (format bar docked
above the keyboard, "Aa" in the nav bar) assumes editing is the default state.

### Phase 0 — spike branch, no app code

Branch `spike/enriched-editor`. Same shape as the Stage 13 Phase 0 spike. Load **real
decrypted note HTML** into `EnrichedTextInput` and answer, with evidence:

1. **Round-trip fidelity.** Does existing TenTap HTML come back out unchanged? Any tag
   silently dropped is silent data loss across every note. This is the go/no-go question.
2. **Nested lists.** The library documents support for **one level only**. What happens to
   nested `<ul>` already in the notes — flattened, dropped, or preserved-but-uneditable?
   Stage 12 plans indent/outdent on list items, so this decides whether that ships.
3. **Web.** Support is marked *experimental* (`docs/WEB.md` upstream). Stage 13's premise
   is that dropping the WebView helps web; if the input doesn't run there, that argument
   disappears and Stage 13 needs rethinking.
4. **Highlight and text colour.** Present in the toolbar reference, and the whole reason
   markdown was rejected. Confirm HTML actually carries them through this component.
5. **Long notes.** Behaviour and memory on a 5000+ word note.

**Deliverable:** `docs/editor-migration-findings.md` with an explicit **GO / NO-GO**.
NO-GO is a legitimate outcome — staying on TenTap is a real option, and the spike exists
to make that answerable instead of guessable. Escalate before changing any app code.

### Phase 1 — the swap (only on GO)

- Replace `components/RichEditor.native.tsx` and `components/RichEditor.tsx`.
- Drop `@10play/tentap-editor` and `react-native-webview`.
- Remove the `react-dom` 18-vs-19 `overrides` block in `package.json` — it exists only
  because TenTap hard-depends on react-dom 18, and it goes when TenTap does.
- **Re-verify `isBlankNote()` and `noteToPlainText()` (`types/note.ts`) against the new
  tag set.** Both parse editor output. `isBlankNote` is the one that matters: it decides
  whether a note gets **permanently deleted** rather than trashed, so a tag it doesn't
  recognise as content is destructive. It gets its own test, not a glance.
- Native rebuild required (new native module).

**Checkpoint:** every existing note opens, renders and re-saves byte-identically where
untouched; formatting controls in `formatting-toolbar-desktop.png` all work; no WebView
remains in the dependency tree.

---

## Stage 11.7 — iPad landscape layout ✅ DONE (2026-08-22)

**Reported by Adam:** folder title size inconsistency and icon alignment issues.
**iPhone is fine; the problems are on iPad, especially LANDSCAPE.**

**Why landscape specifically is the suspect.** `NotesLayout.tsx:124`:

```
foldersArePersistent = isWideLayout && (Platform.OS !== 'ios' || isLandscape)
```

**iPad landscape is the only configuration in the app that puts three panes on
screen at once** — folders, list and editor. Desktop is wide but not iOS;
iPad portrait floats the folder panel as an overlay; the phone navigates
between screens. So this layout path has effectively never been exercised, which
matches the report precisely.

**A concrete defect already found by reading `components/FolderRow.tsx`:** the
folder icon scales with depth (`iconSizeForDepth`, 20px at top level down to
15px at level 4) while the label is always `text-base`, and **the icon has no
fixed-width container**. A 20px icon and a 15px icon therefore push their labels
to different x positions, so label left edges go ragged down a nested tree —
*on top of* the intentional 16px-per-level indent. Barely visible in a
full-width phone sidebar; obvious in a 320pt pane. Fix is a fixed-width icon
slot with the icon centred inside, which keeps the depth-based sizing.

**Also to check in this stage:** the default `sidebarWidth` of 320 and its
resize logic were written for desktop; confirm the list pane is not squeezed at
three-pane widths, and that the header shape is right (`useCompactHeader` is
false here, so it takes the wide treatment).

### ⚠ BLOCKED ON A PERMISSION

**I cannot rotate the simulator.** `osascript` returns
`Not authorized to send Apple events to System Events (-1743)`, and `simctl`
has no rotation command. Either:
- Adam leaves the iPad simulator **in landscape** and I work against that, or
- Adam grants Terminal/Claude automation permission once
  (System Settings → Privacy & Security → Automation), which unblocks
  `Cmd+←`/`Cmd+→` rotation for the rest of the project.

Do not "verify" this stage from portrait screenshots and reasoning. The whole
point is that landscape is the untested path.

---

### Outcome (2026-08-22)

Shipped on branch `stage-11-7-ipad-landscape`, commit `50a17f2`.

**The rotation blocker turned out not to exist.** `osascript` really is refused
(`-1743 Not authorized to send Apple events to System Events`) and `simctl` has
no rotation verb, but the simulator was **already sitting in LandscapeRight** —
`~/Library/Preferences/com.apple.iphonesimulator.plist` records it per device
under `DevicePreferences:<UDID>:SimulatorWindowOrientation`. Read that key
before assuming the device needs rotating.

**Two things to know for the next landscape session.**

1. `xcrun simctl io … screenshot` returns the **portrait framebuffer** whatever
   the device orientation is. Rotate it with `sips -r 90` to read it.
2. The simulator-control tool's tap coordinates are in that same portrait frame,
   so they do **not** match what the rotated screenshot shows. For LandscapeRight
   the mapping is:

   > upright-landscape point `(X, Y)` in pt  →  tool coordinates `(Y, 1376 − X)`

   where 1376 is the iPad's long edge in points. Every tap in this stage used it.
   Getting this wrong is silent — the tap lands somewhere plausible and nothing
   happens, which reads exactly like a dead control.

**What was actually wrong.** All three bugs are the same mistake: code assuming
its parent is the screen. Landscape iPad is the only layout in this app that
puts three panes up at once, so it is the only place a component is narrower
than the window. Full detail in the commit message; the short version:

| Bug | Where | Visible as |
|---|---|---|
| Dialogs centred in their own pane | 4 hand-rolled copies of `absolute inset-0 … bg-black/40` | New Folder rendered as a box jammed against the left edge of the display |
| `bg-black/40` does not paint inside an RN `Modal` | the new `DialogOverlay` | dialog centred correctly, app at full brightness behind it |
| Overflow menu right-aligned under a left-edge trigger | `FolderSidebar` `placement` | menu's left edge at ≈ −20, corner clipped off screen |
| Folder icon has no fixed-width slot | `FolderRow` | indent step reads 16pt, is really 14.75 — nested labels drift left |

**Verified on device, in landscape, not from portrait and reasoning:** menu fully
on screen with both corners; dialog centred on the *window* with the whole app
dimmed behind it; nested `Reference → Papers` measured at **16.0pt per level**.
Re-checked on iPhone 17 Pro: menu placement and dialog both unchanged except
that the phone now gets the backdrop it never actually had.

**Left behind deliberately:** two empty test folders, `Reference` and
`Reference/Papers`, on the iPad simulator only. It is not signed in, so they are
local. Deleting them meant aiming taps at a Delete Folder item in a rotated
coordinate frame, which is a worse risk than the clutter.

**Not converted:** `PlaintextConsentDialog` still hand-rolls the same overlay. It
is rendered at the root in `app/_layout.tsx`, so it is already full-screen and
correct — but it is now the one copy of a pattern that has a shared component,
and it sits on the key-setup boot path. Convert it in a stage that is already
touching that path, not in a layout stage.

**Noticed, not this stage's bug:** the signed-in iPhone shows an **"Unreadable
folder"** row — a folder name that failed to decrypt on the live stack. Pre-dates
this work and needs its own look.

---

## Stage 11.6 — Vendor ReanimatedSwipeable ✅ DONE (2026-08-22)

**Why.** The hand-rolled swipe row has now had three bugs (unreachable commit
threshold, collapsed easing, a vertical guard so tight the gesture cancelled
itself). Adam's call: that is too much surface area to own, and a maintained
library we customise is a better base. Agreed.

**Why we cannot simply `import` it.** Researched 2026-08-22:
- ReanimatedSwipeable's left-hand actions **do not receive taps**. This is
  upstream [issue #3223](https://github.com/software-mansion/react-native-gesture-handler/issues/3223),
  fixed by [PR #4192](https://github.com/software-mansion/react-native-gesture-handler/pull/4192).
  The stated cause matches what was diagnosed here independently: *"On Android,
  an opacity-0 view still receives touches, so the hidden side stays on top in
  z-order and swallows taps."* The fix is `pointerEvents: 'none'` on the hidden
  container.
- **PR #4192 merged 2026-06-16. RNGH 2.32.0 — the highest 2.x — shipped
  2026-06-11.** No 2.x release contains the fix.
- RNGH **3.x requires React Native ≥ 0.82**. This project is on **0.81.5**
  (Expo SDK 54, which pins `react-native-gesture-handler` to `~2.28.0`).
- So the fix is unreachable without an Expo SDK upgrade, which is its own
  project and not Stage 11's.
- **On "force swipe" — the right name is FULL SWIPE, and the library gets us
  most of the way there.** Corrected 2026-08-22 after Adam pushed back, and he
  was right:
  - **Overshoot IS a library feature**, and a named one: `overshootLeft` /
    `overshootRight` (on by default when a render function is present) and
    `overshootFriction` (docs recommend 8+ "for a native feel"). Dragging *past*
    the revealed options is exactly what those do — that is what the demo GIF
    shows.
  - **Snapping after reveal IS a library feature** too: `leftThreshold` /
    `rightThreshold`.
  - **`progress` is the signal we need.** Documented verbatim: *"It equals `0`
    when the `Swipeable` is fully closed and `1` when it is fully opened. As the
    element overshoots its open position, the value approaches `Infinity`."*
    So "has the user swiped past the options?" is answerable from the library's
    own public API, in a render function, with no vendored-file changes.
  - **What is genuinely absent is only the ACTIVATION** — firing the action on
    release instead of leaving the row open. That is
    [discussion #2520](https://github.com/software-mansion/react-native-gesture-handler/discussions/2520),
    "Full Swipe functionality where one button overtakes the other when swiped
    beyond certain threshold", still an open request in current 3.x.

  This reframes step 3 below from "build the gesture ourselves" to "read the
  library's documented overshoot signal and add the action" — a much smaller
  and much safer piece of code to own.

**Decision (Adam, 2026-08-22): vendor the component.**

### Plan

1. **Copy** `ReanimatedSwipeable` into `components/vendor/ReanimatedSwipeable/`
   from the installed 2.28.0 source, keeping its structure, naming and comments
   intact so it stays diffable against upstream. Add a header stating the
   version it was taken from, why, and the exact upstream fix applied.
2. **Apply PR #4192's own change** — `pointerEvents: 'none'` on each action
   container while it is hidden — rather than inventing a different fix.
3. **Add full swipe on top, using the library's documented overshoot signal.**
   `progress` exceeds 1 while overshooting and returns to 1 on release, so the
   wrapper watches `progress` in a `useAnimatedReaction`, records that the peak
   went past a commit threshold, and fires the action plus
   `swipeableMethods.close()` when the release arrives via `onSwipeableWillOpen`.
   Enable `overshootLeft`/`overshootRight` and set `overshootFriction` to 8 per
   the docs' own recommendation. **No changes to the vendored file for this** —
   it lives entirely in our wrapper, on public API.
4. **Keep `swipeMath.ts` and its 16 tests.** The commit fractions, the capsule
   stretch and the arm thresholds are ours regardless of who owns the pan.
5. **`SwipeableNoteRow` keeps its public props unchanged**, including the
   `testOpen` seam, so `/dev-swipe` and `NoteListPane` need no edits.
6. **Keep the hand-rolled implementation on a branch** (`swipe/hand-rolled`)
   rather than deleting it, per Adam: "keep our solution on pause, we can
   return to it if this approach doesn't work."

### Outcome (2026-08-22)

Shipped on branch `stage-11-6-vendor-swipeable`, commit `f441b8b`.

**One deviation from the plan above, deliberate.** Step 3 said full swipe would
live entirely in the wrapper on public API, with no changes to the vendored
file. It does not — it is implemented inside `handleRelease`, as three new props
(`fullSwipeLeftThreshold`, `fullSwipeRightThreshold`, `onFullSwipe`) written in
the library's own naming and callback conventions.

The public-API version does not work reliably. Reading the armed state from
`progress` means deciding at RELEASE whether the peak went past the threshold,
and the only public release signal is `onSwipeableWillOpen` — which is
`runOnJS`'d, so it arrives on the JS thread some frames after the spring has
already started unwinding the overshoot that the armed flag was derived from.
Whether the flag is still set when the callback lands is a race, and losing it
fires nothing. `handleRelease` is the only place that knows the release distance
at the moment of release. Vendoring is what makes this reachable, and it is the
reason vendoring was the right call rather than a cost of it.

**Verified, both platforms, not asserted:**

| Check | iPhone 17 Pro | Android (notes_b, Pixel-class, 440dpi) |
|---|---|---|
| `/dev-swipe`, all four actions tapped | **PASS** | **PASS** |
| Pin — the action upstream issue #3223 breaks | fires | fires |
| Real gesture reveals the panel | not automatable | yes, snaps to the panel width |
| Full swipe right → Pin | not automatable | **fires, row closes itself** |
| Full swipe left → Delete | not automatable | **fires, row closes itself** |
| Medium swipe left reveals WITHOUT committing | not automatable | yes — counts stayed `{}` |
| Tapping an open row closes it, does not open the note | — | yes |
| Mostly-vertical drag across a row does not open it | — | yes |
| Real note list, not just the harness | — | yes, 3 notes intact |

iOS gestures still cannot be automated at all — injected touches never reach a
`UIGestureRecognizer`. What `/dev-swipe` proves there is hit-testing, which is
where the Pin bug actually lived. The pan itself is now the library's and is
identical code on both platforms, so Android exercising it is worth more than it
was when the pan was ours.

**Not verified: vertical scrolling through a LONG list.** The dev stack has three
notes, so nothing scrolls. A diagonal drag correctly failed to open a row, which
is the arbitration this depends on, but a genuinely long list has not been
scrolled. Watch for it the first time the list is longer than a screen.

**One thing to know about the gesture that is not obvious.** A swipe that starts
within ~20dp of either screen edge is eaten by Android's back gesture and leaves
the app entirely. That is the OS, not this code, but it makes automated swipes
look like crashes — start them well inside the row.

### Exit condition

`/dev-swipe` PASSes all four actions on **both** platforms, force-swipe commits
on Android, and the row still scrolls the list normally. If the vendored
component cannot do force-swipe cleanly, ship without it and record that —
Adam has explicitly accepted compromising on features to reduce bug surface.

### Delete this stage when

Expo moves this project to RN ≥ 0.82. At that point delete
`components/vendor/` and import `ReanimatedSwipeable` from the package.

---

## Stage 12 — Floating Menu Chrome (Mobile + iPad + Desktop) + Formatting Toolbar + Find/Replace

**Standing rule for this stage:** almost all screenshots now exist (rescanned 2026-08-21). Where one exists, it's authoritative. **Where one doesn't** (currently just the mobile scrolling-bar collapsed state) **follow Apple Notes' own design** for the equivalent control rather than inventing something — that's the explicit fallback, not a license to improvise.

- **Desktop top menu:** transparent, floating over the editor, Apple-Notes-style drop shadow tinted to the theme color; title doesn't overlap on a new note, only overlaps on scroll. Left group: New Note, Maximize/Restore. Center group: formatting toolbar (Apple desktop style) + context-aware menu (indent/outdent/strikethrough when on a list item). Right: Share + Menu, and Search bar as its own group. **This stage receives the search bar and New Note button that Stage 11 removes from the list pane.**
- **Minimize/restore behavior**, tied to folder-view and editor-view state (four combinations per the original spec).
- **iPad:** inherits desktop's left/center/right grouping, but **collapsible-first** — groups that sit permanently expanded on desktop start collapsed and expand on tap. **"Aa" is pinned to the top nav bar**, matching desktop rather than the phone's keyboard-adjacent placement. Exact collapse triggers and which groups stay visible: decide against the iPad screenshots once they exist.
- **Mobile top nav bar** (fixed, standard height, not floating): Back leftmost; immediately right of it a grouped cluster — **"Aa" · Undo · Redo**. "Aa" drops a submenu below the nav bar with paragraph styles (Title, Heading, Subheading, Body). Redo is contextual — hidden/disabled until something's been undone, never a permanently-visible dead button. Right side keeps Share + Menu. **The Menu's contents include "Move Note"** (per `list-view/mobile-move-to-folder-from-note-editor-menu.png`), which calls Stage 11's folder-picker component rather than a new one — this is the third of Stage 11's three Move entry points, and the only one this stage wires.
- **Mobile horizontal scrolling context bar** — separate control docked directly above the software keyboard (iOS's native in-context format-selector position). Inline formatting icons (bold, italic, underline, strikethrough, checklist, bulleted/numbered list, indent, link, table, image) scrolling horizontally on overflow, no wrapping, snapping to a clean icon edge. **Expandable:** tapping a control or dedicated affordance grows it upward into a taller panel — still docked above the keyboard, proportional height, not full-screen — revealing grouped/secondary options.
- **Find in Note** and **Find & Replace** on **both mobile and desktop**, with separate layouts per platform (replace-field entry and match-navigation can't share a layout across those widths).
- Glass surfaces on the nav-bar cluster and scrolling bar, system font, icon-first with minimal labels, spring expand/collapse on Stage 9's motion primitives. Hover/press behavior and all button sizing are specified in the icon-button system below — that section is authoritative; ≥44px is the *touch* target there, not the painted size.

- **Haptics: adopt Pulsar** (Software Mansion) for the press/commit feedback on these
  controls. The app currently fires one-shot `expo-haptics` impacts at swipe commit and
  long-press; Pulsar is the patterned version of the same idea and belongs with the
  interaction work rather than in a stage of its own. Added 2026-08-21.

### Stage 12h — docs consolidation, and the format bar follows the keyboard ✅ DONE (2026-08-22), branch `docs/dev-docs-consolidation`

**`dev-docs/` is now the planning tree, and it is tracked.** `prd.md`, both build
plans and the design screenshots (from `build-docs/design/`) moved there and came
out of `.gitignore`; `dev-docs/README.md` says what belongs in it and what does
not. `docs/` stays the user-facing set. Every reference repointed — `CLAUDE.md`,
`components/IconButton.tsx`, `lib/layout/paneChrome.ts`, `lib/powersync/db.ts`,
both `scripts/verify-legacy-plaintext-*.ts`, and the cross-references inside the
plans themselves.

Scrub found less than expected: no keys, no recovery codes, three email
addresses, two of which are the landing page's own deliberately-public contact.
The third — a personal address used as a test account — is genericised. Worth
stating plainly: **the commit history carries the author's address regardless**,
so this is tidiness, not redaction.

**The mobile format bar now appears only with the keyboard or a selection**
(Adam, 2026-08-22). It used to stay put when the keyboard went down, on the
reasoning that it is a phone's only formatting affordance. The consequence was a
bar occupying the bottom of the screen while you were only READING, which is most
of what anyone does with a note. Dismissing the keyboard is how you say "done
editing", and the bar now hears it. `onChangeSelection` supplies the second
condition, for the case where a range is highlighted with no software keyboard.

**⚠️ CORRECTION TO 12d: the Done button was inert on iOS.** It rendered, it
pressed, and the keyboard stayed up. `Keyboard.dismiss()` blurs the focused *RN*
`TextInput`; this editor is a real `UITextView` behind a Fabric component and
never saw it. 12d recorded Done as verified on the strength of its APPEARANCE in
a screenshot, which is exactly the gap `CLAUDE.md`'s verification rule exists to
close. `RichEditor` is now a `forwardRef` exposing `blur()`, and Done calls that.
Found only because this change made the bar's disappearance the thing under test.

`useKeyboardShown` moved to `hooks/` — `NoteEditorPane` and `RichEditor` both
need it and must agree, or Done and the bar would appear a frame apart on one
platform and read as jank.

**Verified on iPhone 17 Pro, full cycle:** cold launch with the keyboard down →
no bar, no Done; tap into the text → both appear, bar docked to the keyboard;
Done → both leave. `tsc` clean, 119/119, lint at the 8-warning baseline.

---

### Stage 12g — web is no longer a dead end ✅ DONE (2026-08-22), branch `stage-12g-web-unblock`

Adam, 2026-08-22: the `Notes couldn't start` screen "should never be seen by the
user, there has to be a way through it, at least something the user can do from
within the app, while theyre able to work offline". Two halves, both done.

**Web reaches the real app.** It used to be structurally guaranteed not to: no
`expo-secure-store` on web, so no device key, and `@powersync/react-native` +
op-sqlite do not exist there. Both are now behind `.web.ts` seams —
`lib/crypto/secureStorage.ts` and `lib/powersync/openDatabase.ts` — so `db.ts`
and `vault.ts` are single-platform-free and nothing on native changed shape.
Verified end to end in the browser: a note created, typed into, saved encrypted,
titled, and listed.

**Memory-only, deliberately, on BOTH halves.** The vault keys live in a Map and
the database lives in wa-sqlite's `InMemoryVfs`. Persisting either on web means
answering the at-rest question — Stage 13's Phase 0 spike — and answering it
badly (a data key in `localStorage`) would be worse than not persisting at all.
Nothing is written down, so there is nothing at rest and no key to store. The two
have to agree or one of them is lying about the other.

**The web editor now edits.** Read-only was the wrong answer: a note you can open
and cannot type into is the same dead end one screen further in. Plain text, via
`lib/notes/plainTextBody.ts`, with the guard that matters — `isPlainTextSafe`
refuses to edit a note whose formatting the projection would flatten, because the
editor autosaves and merely OPENING such a note would have destroyed it.

**The failure screen is non-terminal on both platforms:** Try again (primary,
non-destructive) · Reload the page (web only, and genuinely different — it
re-fetches the bundle and wasm, which a retry cannot) · Reset this device
(confirmed, destructive, unchanged).

**A hang is now a failure, not a spinner.** Found by deleting the worker asset:
the database open neither resolved nor rejected, so the app sat on the boot
spinner forever — no error, no exit. `BOOT_TIMEOUT_MS` (20s) turns that into the
failure screen, and `closePowerSync()` now forgets a hung `initInFlight` so Try
again genuinely starts over instead of joining the dead promise.

**Recovery also lives in Manage Account** (Adam's call) as a "Storage on this
device" group: where notes are kept, and Reset local data behind a two-step
confirm. It used to be reachable only from an app that had already failed to
start.

**Gotcha, found on the iPhone:** Gluestack's `Modal` portals its children into
the overlay host, which `GluestackUIProvider` mounts OUTSIDE `<VaultProvider>`.
`useVault()` inside the modal throws. The hook is read in `ManageAccountDialog`'s
own body and passed down as a prop.

**Verified:** iPhone 17 Pro — app boots, existing notes decrypt, Manage Account
renders and its confirm/cancel works. Web — boots, creates, types, saves, lists;
worker deleted → failure screen with all three actions; worker restored → **Try
again recovered in place, without a reload**. `tsc` clean, 119/119 tests, lint at
the 8-warning / 0-error baseline.

**Not done, deliberate:** export/reimport is Stage 13's, so a web session's notes
still cannot be carried anywhere. And with no persisted session, Manage Account —
and therefore the storage explanation — is reachable on web only after signing
in; the editor's own badge is what states it otherwise.

---

### Stage 12d — mobile chrome ✅ DONE (2026-08-22), branch `stage-12d-mobile-chrome`

Both zones, verified on iPhone 17 Pro and on Android with a real software keyboard.

**Nav bar** — floats over the note (the screenshot wins over the prose): Back ·
Undo · Share/`…` capsule · accent Done. **No `Aa`** (Adam). `RichEditor` gained
`contentInsetTop` so the first line clears the floating bar.

**Keyboard bar** — one capsule that scrolls inside itself, expand affordance
pinned outside the scroller. Built as a full-width strip first and the rounded
ends were clipped off the screen, which read as a failed layout rather than as
more icons to the right.

**Context-awareness, wired to the editor's real `onChangeState`:** a bullet
promotes indent/outdent/strikethrough; a blank body line promotes heading and
bullet; selected renders as the accent circle. `lib/notes/toolbarContext.ts`
owns the order with its invariants under test — chiefly *the set never changes,
only the sequence*, which is what stops a control sliding out from under a thumb
already reaching for it.

**Both kinds of dimmed now come from real state:** the five the editor cannot
perform, and `isBlocking` for a format inapplicable at the caret. Verified —
Bold correctly dims inside a heading.

**First line is a heading**, carried in the document (`toEnrichedHtml('')` seeds
`<h1></h1>`). Tested against `isBlankNote`, which decides whether a note is
**permanently deleted** — an empty `<h1>` reads blank exactly as an empty `<p>` did.

**⚠️ UNDO/REDO DO NOT EXIST.** `react-native-enriched-html` exposes no undo or
redo API at all. Undo renders dimmed; Redo, specified as hidden until something
is undone, never arms — satisfying both rules at once. **Revisit at iteration
end:** the editor already keeps a ledger of every version it produced
(`echoesRef`), so an undo stack on `setValue` is plausible; the open question is
the caret, which `setValue` does not preserve.

**Known over-reach, deliberate:** `onBlankBodyLine` is approximated as "no block
format active", so Heading and Bullet also come forward on ordinary body text.
`onChangeState` reports formats, never whether a line has text, and reading the
caret's line on every keystroke would cost a round trip per character to sharpen
a rule that is already useful.

---

## Stage 12 — closed 2026-08-22

All seven sub-phases merged. What the stage set out to do and what it actually
took:

| | outcome |
|---|---|
| 12a icon buttons | the shared primitive; every icon button converted |
| 12b web boots | to its own error screen — superseded by 12g |
| 12c desktop chrome | matrix, bar, harness, then **wired live** once 12g unblocked it |
| 12d mobile chrome | nav bar, keyboard-docked context bar, heading seed, Move Note |
| 12e iPad chrome | its own bar and style grid; portrait + landscape on device |
| 12f find & replace | both platforms, haptic vocabulary, this audit |
| 12g web unblock | **not in the original plan** — web reaches the real app |

**Two plan assumptions turned out wrong, both recorded where they bit.** iPad
was going to inherit desktop's grouping; the screenshot said otherwise and won.
And 12c's blocker — "wiring the bar is 100% unverifiable" — was true when
written and dissolved the moment web could open a database, which is why 12g
exists at all.

**Standing state after the stage:**

- **Native rebuild owed.** `react-native-pulsar` and `expo-blur` are in
  `package.json` and neither is in the current binary. Haptics degrade to
  silence; `expo-blur` is not imported anywhere yet (Glass is an unbuilt theme).
  `expo prebuild` + `pod install` + `expo run:ios`, `LANG` set to UTF-8.
- **Simulator Automation permission** is being granted after this stage;
  rotation needed doing by hand throughout.
- **Split View** is asserted by width tests, not driven on device — injected
  touches cannot drag out of the Dock.
- **Undo/redo do not exist** in `react-native-enriched-html`. Retry at iteration
  end on a `setValue` snapshot stack; the open question is the caret.
- **Five formatting controls dim permanently** — highlight, text colour, indent,
  outdent, table — plus `dashedList` on the desktop panel. Same retry.
- **`folderPaneShowsCollapse` is unimplemented**: with the list hidden and
  folders shown, hiding the folders takes two steps. No reference exists for a
  folder-pane control.
- **Web is session-only.** Export/reimport is Stage 13's, so a web session's
  notes still cannot leave the tab.

---

### Stage 12f — Find & Replace, haptics, stage audit ✅ DONE (2026-08-22), branch `stage-12f-find-replace`

**The three-way contention at the bottom of a phone is decided, not
discovered** — the plan's own requirement. Keyboard, formatting bar, find bar:
**the formatting bar hides while find is open.** You are searching, not
formatting, they are never both wanted at once, and neither has to shrink for
the other. The find bar then takes the same slot and rides the keyboard through
the same `useAnimatedKeyboard`, so the two are interchangeable rather than
merely similar.

**Two coordinate systems, and that is the whole design.** Finding happens in
PLAIN TEXT, because that is what the user sees and what `setSelection` counts
in. Replacing happens in HTML and must avoid markup entirely — a naive
`html.replaceAll('b', …)` rewrites every `<b>` tag into something that is no
longer HTML, and single-letter searches are the first thing anybody types.
`lib/notes/findMatches.ts` owns both, with 14 tests including attribute values,
unterminated tags, and matches that straddle a tag boundary (not found, and
deliberately: deciding which half keeps the `<b>` has no right answer).

**Matches are revealed deliberately, not automatically — found on the phone.**
Selecting a range requires focusing the editor, because an unfocused
`UITextView` does not draw a selection. But focusing the editor takes focus off
the Find field, so the first version moved the keyboard to the note after one
keystroke and the query could not be finished. Typing now updates the COUNT
only; next, previous and the return key reveal. Which is also what iOS does.

**⌘F / Ctrl+F on web.** Not a nicety: a find bar reachable only from an overflow
menu is one nobody finds, and the browser's own ⌘F would otherwise search
whatever the virtualised list happens to have mounted.

**Two copy bugs caught on device.** After a Replace there is no current match,
and the status printed **"0 of 3"** — a counter that looks broken. And typing a
query used to claim "1 of 4" before anything had been revealed, so next would
jump to match two and skip one the user was told they were on. The bar now says
"4 matches" until something is actually revealed.

**⚠️ HAPTICS CRASHED THE APP, and the fix is the interesting part.**
`react-native-pulsar` went into `package.json` in 12a but the native app was
never rebuilt, so importing it threw at launch:

> `TurboModuleRegistry.getEnforcing(...): 'RNPulsar' could not be found.`

`getEnforcing` runs at MODULE SCOPE, so the throw happens during `import` and a
`try` around the call site cannot catch it. `lib/theme/haptics.ts` now
`require`s lazily inside its guarded call and memoises — a binary without the
module degrades to silence rather than to a crash, which is the right behaviour
regardless.

**Haptics are therefore wired but inert until a native rebuild**
(`expo prebuild` + `pod install` + `expo run:ios`, with `LANG` set to a UTF-8
locale). They cannot be verified on a simulator in any case — no Taptic Engine —
so confirming them needs a physical device. Three meanings, not thirty presets:
`tap` from every icon button, `step` when moving between matches, `commit` after
a replace. A fourth, `toggleOn`, was dropped rather than left unused: the shared
icon button cannot tell a toggle that is off from a plain action, so nothing
could call it correctly.

**Verified.** iPhone: find opens from the overflow menu, the caret stays in the
Find field while typing, "1 of 3" and "2 of 3" step through with the match
selected in the note, and Replace rewrote exactly the current match
("through" → "THrough") leaving the other two alone. Web at 1280pt: ⌘F opens the
inline two-row bar, "4 matches" → next → "1 of 4" → Replace All with "dog"
rewrote all four including "Cat" and "CAT" → "No results". `tsc` clean, 151/151,
lint at the 8-warning / 0-error baseline.

---

### Stage 12e — iPad chrome ✅ DONE (2026-08-22), branch `stage-12e-ipad-chrome`

**Portrait and landscape verified on device.** Adam rotated the simulator by
hand — `osascript` returns *"Not authorized to send Apple events to System
Events. (-1743)"* and the Automation permission is being fixed at the end of the
stage.

**Split View is verified by test, not on device, and that is a hard limit.**
Injected touches reveal the Dock but cannot drag an app out of it: that is a
`UIDragInteraction`, and injected touches never reach UIKit's recognisers — the
same root cause as the RNGH swipe problem from Stage 11. So the requirement is
met the other way. What Split View actually does to this app is make its window
narrow; every other consequence follows. `lib/layout/editorChrome.ts` decides
the chrome from width and platform, and `tests/editorChrome.test.ts` asserts it
at the real Split View widths — **320pt and 507pt get the PHONE chrome even
though `isPad` is true**, which is the trap, and 880pt keeps the iPad bar. The
narrow path is separately exercised live on the iPhone all session.

**The plan's prose was wrong and the screenshot won.** The plan said iPad would
inherit desktop's left/centre/right grouping. `ipad-collapsed-groups.jpeg` draws
something else: one capsule on the left (maximise, compose), four SEPARATE
circles on the right (Aa, Share, more, search), no centre zone, and no inline
search field. `PadTopBar` is its own component rather than a `variant` of
`DesktopTopBar`, because a variant switch around two layouts that share only
their height is not a shared component.

**Search is a circle, not a field**, and that is a Split View decision: an iPad
pane can be 320pt wide and a permanently-expanded field would take most of it.
Pressing it reveals the note list and puts the caret in that list's search
field — revealing is part of the action, or it would be a button that does
nothing whenever the panes happen to be hidden. Driven by a COUNTER, not a
boolean: "focus the search field" is an event, and a boolean would fire once and
then never again.

**Collapsible-first**, as the plan asked: the maximise control is always present
and its glyph flips, unlike desktop's restore which only appears once something
is hidden. On an iPad, hiding the panes is the ordinary way to get room, not a
recovery from having hidden them.

**`PadStylePanel` is a GRID**, where desktop's is a vertical list —
`ipad-expanded-groups.jpeg`. Paragraph styles are pills in a scrolling row,
then B/I/U/S, then marks + lists, then nesting + quote. A vertical list of eight
rows is fine under a mouse and taller than the pane under a thumb in Split View.

**Two bugs found by putting it on the device:**

*The bars sat under the status bar.* Both floating bars pin to `top: 0` and
neither applied the safe-area inset — invisible on web, where it is zero, and
immediately obvious on an iPad where the clock runs across the top. Both take a
`topInset` now.

*The pill row went blank whenever a list was active.* The pills were driven by
`activeParagraphStyle`, which treats lists as paragraph styles, so a note with a
bullet in it highlighted nothing at all. A bulleted list has a text style like
any other line — `activeTextStyle` is the separate derivation, with tests. The
desktop panel keeps the original, because there lists ARE rows in the same list
and one tick across all of them is right.

Also: the active pill is scrolled into view on open, from its own `onLayout`
rather than an index-times-width guess. Without it the row always started at
Title and the highlighted pill — on a Body note, the common case — sat half off
the right edge the moment the panel appeared.

**Verified on iPad Pro 13 in landscape:** the bar clears the status bar; the
`Aa` grid renders with Body highlighted and the active list accented while
highlight/colour/indent/outdent dim; maximise hides both panes and the glyph
flips; the search circle restores the list and focuses its field. `tsc` clean,
131/131, lint at the 8-warning baseline.

---

### Stage 12d (leftover) — Move Note in the editor menu ✅ DONE (2026-08-22), branch `stage-12d-move-note`

The one item 12d's plan named and 12d did not build. Wired to **Stage 11's**
`FolderPickerSheet`, not a second picker: a note filed from the editor and one
filed from the list now go through the same screen, the same folder ordering and
the same inline "New Folder". That is the reason to reuse it — not that it saves
work.

Desktop is excluded for the reason `NoteListPane` already excludes it: there the
picker is a flyout anchored to the click, and a menu row has no anchor to give
it. Desktop files notes from the list, where the anchor exists.

**Verified on iPhone 17 Pro:** menu → Move Note → picker showing the note's own
title, All Notes and Skills correctly dimmed → chose Therapy → the list row now
reads "Therapy".

---

### Stage 12c — desktop top bar + minimize/restore ✅ DONE (2026-08-22), branches `stage-12c-desktop-chrome` then `stage-12c-desktop-wiring`

**The blocker is gone and the bar is wired.** 12c built the matrix, the bar and
the harness but could not wire any of it: web had no database, so a bar over a
real document was unverifiable. 12g gave web real notes. The bar now floats over
the live editor on web at wide widths, and all four minimize/restore states were
walked in the browser with the restore-control count asserted at each one:

| state | restore controls | which |
|---|---|---|
| both shown | 0 | — |
| folders hidden | 1 | Show folders, in the list pane |
| neither | 1 | Show note list, in the editor's capsule |
| list hidden | 1 | Show note list |

**Stage 11's debt is paid.** Search and New Note left the desktop list pane —
they were kept there "for now on every platform" precisely until this bar
existed. Two search fields on one screen is worse than the wrong one, because
you cannot tell which list either filters. A wide iPad keeps its bottom bar
until 12e.

**Two real bugs the wiring surfaced:**

The list pane's folder button was labelled **"Show folders" permanently**, so a
screen reader announced the opposite of what it did whenever folders were on
screen. It now reads its label from the matrix.

Removing the desktop header row took the list's collapse control with it, making
the both-hidden state unreachable and half the matrix dead code. The references
show the RESULT of hiding the list but never the control — macOS puts it in the
View menu, which this app has no equivalent of. A `PanelLeftClose` button in the
list pane header is a **deliberate divergence**, recorded rather than silently
added.

**The `Aa` panel is built and NOT live.** `TextStylePanel` renders the
reference's popover — inline marks over paragraph styles, drawn in the style
they apply, exactly one row ticked. But the desktop bar is web-only, and the web
editor is plain text, so `Aa` and Checklist correctly render **dimmed** there
under the standing grey-out rule (`EDITOR_SUPPORTS_FORMATTING`, a build-time
constant that flips with the `.web.tsx` resolution). Rather than ship it
unlooked-at, it is driven by a fixture in `app/dev-chrome.tsx` and its logic is
extracted to `lib/notes/paragraphStyle.ts` with 8 tests. It goes live with the
iPad chrome in 12e, where a native editor sits behind it.

**Body is derived, not reported.** The editor has no "paragraph" state — a plain
line is simply none of h1–h3, code block, quote or the three lists. So the menu
infers it, which is what stops an ordinary line showing nothing ticked. The
inverse matters more: "make this Body" is *toggle off whatever is on*, and the
naive version — toggle every block style — would turn six of them ON, because
the editor's block toggles are their own inverse. That is the test that earns
its keep.

**Known, two steps not one:** with the list hidden and folders shown, there is no
way to hide the folders — that control lives in the list pane header, which is
itself hidden. Restore the list first. `paneChrome` provides
`folderPaneShowsCollapse` for a folder-pane control that does not exist yet;
there is no reference for one.

**Verified:** four states walked in the browser, the `Aa` panel's mutual
exclusion checked via `aria-checked` before and after (Body → Heading, exactly
one ticked each time). `tsc` clean, 128/128, lint at the 8-warning baseline.

---

### Stage 12c (first pass) — the matrix, the bar and the harness, branch `stage-12c-desktop-chrome`

**Built and verified:** the matrix, the bar, the harness.
**Not done, and blocked:** wiring the bar into the real `NotesLayout`/`NoteEditorPane`.

`lib/layout/paneChrome.ts` decides which pane owns which control across all four
combinations; `tests/paneChrome.test.ts` asserts the **invariants**, chiefly
*never two ways to restore, and never none*. 8 new tests, 99 total. The rule that
makes it coherent: **each restore control brings back the pane immediately to its
own left**, so the leftmost visible pane owns the only one.

`DesktopTopBar` draws what the matrix hands it. The left zone changes SHAPE
between states — compose alone is a circle, restore + compose is one capsule
(`desktop-minimize-restore-states.png`). Search and New Note are restored here,
clearing the debt Stage 11 left. Table and Attach render dimmed in place.

**The scrim was found by scrolling, not by reasoning.** A fully transparent
floating bar leaves note text threading between the capsules and the glyphs
unreadable. 12 stacked `bg-background` strips at falling opacity rather than
another native module for one gradient — theme-tinted for free. Measured live:
80pt, 8 solid strips then 0.91/0.61/0.30/0.

`app/dev-chrome.tsx` + a narrow `__DEV__` escape hatch in `app/_layout.tsx` for
when the vault has **failed** (native never takes the branch; `AuthProvider` is
deliberately excluded because it calls `connectPowerSync()`).

**⚠️ THE BLOCKER.** The desktop bar targets `Platform.OS === 'web'` only — iPad
gets its own collapsible-first variant in 12e, and phones the two-zone chrome in
12d. Web cannot load a real note (Stage 12b), so **wiring the bar into the live
layout is 100% unverifiable right now**. Writing it anyway is precisely the
"reads correct, does nothing" pattern that produced the dead force-swipe and the
duplicate-note bug. It lands with **Stage 13**, alongside the web data layer that
makes it checkable.

**Worth recording — the web analogue of the iOS gesture problem:**
`react-native-web`'s `Pressable` listens on **pointer** events, so a synthesised
click reaches the element and `onPress` never fires. Every interaction had to be
driven with `pointerdown`/`pointerup`. An automated click that "does nothing" on
web is this, not a broken button.

---

### Stage 12c0 — Theme as its own axis ✅ DONE (2026-08-22), branch `stage-12c0-theme-seam`

**Adam's call, 2026-08-22:** keep the current flat look as a *theme* rather than
letting glass replace it. Two axes, named apart:

| Control | Chooses |
|---|---|
| **Dark Mode** — Device / Light / Dark | which **face** you see (the old "Theme" row, renamed — it never chose anything else) |
| **Theme** — Flat / Glass / Cosmic / Horizon | which light and which dark you get, and how chrome surfaces are painted |

Every theme owns **both** faces, so picking Horizon is not picking dark — it is
picking which dark, and which light. **"Horizon"** is the agreed single name for
the night-sky/day pair.

Only **Flat** exists. Glass, Cosmic and Horizon render as real rows, dimmed,
each saying what it will be and "Coming soon" — same treatment as the
unsupported formatting controls, same reason.

`AppTheme` + `APP_THEMES` live in `contexts/ThemeContext.tsx` under their own
SecureStore key. The boot read validates against the catalogue's **available**
entries, not just the union: a device holding a theme this binary cannot paint
would render nothing and look like a bug.

**Consequence for 12c:** glass is deferred, so `expo-blur` is still unused and
the native rebuild has still not been needed. The desktop chrome ships flat and
gains a glass variant when that theme is built.

---

### Stage 12b — web boots ✅ DONE (2026-08-22), branch `stage-12b-web-boot`

**The recorded blocker was the second one, not the first.** `Appearance.setColorScheme`
is real, but the web bundle died before any app code ran, on a **broken npm hoist that
arrived with Stage 11.5's editor** and that nobody had seen because native never touches it:

```
node_modules/@tiptap/extension-history        <- hoisted to the top level
node_modules/react-native-enriched-html/
  node_modules/@tiptap/extensions             <- NOT hoisted
```

`extension-history` requires `@tiptap/extensions`; from the top level that path does not
exist. `TransformError: ENOENT ... @tiptap/extensions/dist/index.js`. **`npm dedupe` does
not fix it.** The whole `@tiptap` chain belongs to `react-native-enriched-html`'s *web*
implementation — on iOS and Android the editor is genuinely native and none of it is bundled.

Fixed with `components/RichEditor.web.tsx` rather than by touching the dependency tree.
Metro resolves `.web.tsx` first, so one file keeps the chain out of the web bundle and
**no dependency changed**. Notes are read-only on web until Stage 13.

Then the real blocker: `react-native-web` implements Appearance's listener half and not
its setter. Guarded by feature check. On web the equivalent lever is a class on the
document root — `global.css` already defines `:root.dark` / `:root.light`, so the
preference drives the tokens with no new CSS. **Verified in the browser:** no class →
`10 10 12`, `.light` → `251 251 253`, `.dark` → `10 10 12`.

Partial, and worth knowing: Tailwind v4's `dark:` **utility** variant still compiles to a
media query here because there is no `@custom-variant dark`, and adding one changes how
`global.css` compiles for native too. Stage 13's call.

**⚠️ WHERE WEB NOW STOPS, and what it means for 12c.** Web reaches the app's own
`BootFailureScreen`. `expo-secure-store` has no web implementation, so there is no device
key, and `@powersync/react-native` + `op-sqlite` do not exist on web either. Both are
Stage 13 Phase 0, **including the unsolved at-rest question** — so this is as far as a
boot fix can honestly go.

**12c therefore opens by building a dev-only fixture route** (`/dev-chrome`, same
`__DEV__` guard as `/dev-swipe` and `/dev-icons`) and verifies the desktop bar,
the four minimize/restore combinations and Find & Replace against fake notes. That is a
verification seam, not an architecture decision, and the plan sanctioned it up front.

Also removed a committed vim swap file (`components/.RichEditor.web.tsx.swp`) and added
`*.sw[a-p]` to `.gitignore`.

---

### Stage 12a — icon-button system ✅ DONE (2026-08-22), branch `stage-12a-icon-buttons`

`components/IconButton.tsx` + `IconButtonGroup` + `IconButtonBar`. Every icon
button in the app now goes through it. `app/dev-icons.tsx` (dev-only, same
`__DEV__` guard as `/dev-swipe`) puts the whole state matrix on one screen.

**The geometry is MEASURED, not chosen.** `icon-buttons-groups-dark.png` is
638x96, a 2x capture. Sampling its pixels with a BMP parser rather than eyeballing:

| Reading | px | pt |
|---|---|---|
| every surface's height | 72 | **36** |
| lone circle width | 73 | 36 |
| 4-icon capsule / 2-icon capsule | 310 / 160 | 77.5 and 80 per icon → **39 slot** |
| both gaps between surfaces | 37 | **18** |
| inset pill (fill 55 on a 35 capsule) | 51 | **28** |

The capsule is exactly N x slot with no end padding; its rounded ends come from
a radius of half its height. So **44 was never the painted size** — 36 + 4pt
`hitSlop` gives both the reference's proportions and the HIG touch target.
Verified on device: a tap 3pt OUTSIDE the painted circle registers.

**Five states, and hover vs selected differ by SHAPE.** Hover/press are a
rounded square, selected is a filled accent circle — which is how the two
references draw them, and it is what closes the "a hovered button reads as
toggled on" trap without inventing anything.

**Four defects found by looking at it on a device rather than reasoning:**
- `bg-primary` is shadcn's *contrasting* fill — near-**white** in dark mode. This
  app's accent is `lime-500`, which is exactly what `--on-accent` was created for.
- disabled at 35% of `foreground` over a surface was illegible.
- a capsule in a **column** parent stretched to full width (4 icons → a 368pt
  bar), because a flex row defaults to `alignSelf: stretch`.
- insets sat flush against the capsule's rounded ends.

**Two additions to the primitive, both forced by real call sites:**
- `surface="none"` — for controls inside another surface (a folder row's
  chevron, the inline folder-reveal beside a large title). They keep the press
  inset; bare used to mean *no press feedback at all*.
- `glyphStyle` — for the one animated glyph, the chevron's 90° turn on expand.

**Three "no feedback on touch" defects fixed:** `NoteEditorPane`'s Share and
overflow were `hover:bg-muted` with no press state; `FolderRow`'s chevron and
reorder arrows were bare `Pressable`s with none either; `SettingsDialog`'s X
went through `ModalCloseButton`, which closes via the modal's own context and
**skipped `handleClose`**, so the settings view stayed parked on whatever
sub-screen it was left on.

**Grouping was decided per bar, not by a rule** — it is semantic. Share + the
overflow are one capsule ("act on this note"); the desktop avatar sits outside
it (identity); select-mode's Done became `variant="accent"`, matching the
reference's filled checkmark circle.

**Deliberately not converted, with reasons:** `SwipeableNoteRow`'s coloured
action capsules (gesture-revealed, Stage 11 owns their measured geometry);
`AccountField`'s commit button (an `InputSlot` adornment inside a field's
border); `AvatarMenuTrigger`'s avatar branch (identity, not an action glyph —
but it takes `SURFACE`, so it stopped being 32pt beside 44pt buttons);
menu-item glyphs, which sit beside a label and are not buttons.

**Not "left alone" but SCHEDULED:** the editor's existing formatting toolbar
(B/I/U/S/H1/H2/lists/quote/code) is still the old chrome. It is rebuilt from
scratch in 12d with the context-awareness, so restyling it now would be work
thrown away in two sub-phases.

**Verified:** iPhone 17 Pro, iPad Pro 13 landscape, Android `notes_b` — the
editor header matches `icon-buttons-editor-accent.png` on all three (lone round
Back, Share/... capsule). Held at `accessibility-extra-large`: labels truncate
rather than clip, glyphs stay 20pt while text grows, nothing loses its row.
`tsc` clean, 91/91, lint at the 8-warning baseline.

**Deviation from the plan, harmless:** `expo-blur` and `react-native-pulsar` are
installed but nothing imports them yet, so 12a ran on the existing dev client
over Metro. The single native rebuild the plan budgeted for still happens once —
it just waits until 12c actually needs blur.

---

### The icon-button system — **defined here, applied everywhere** (added 2026-08-21, review 4)

This stage owns the shared icon-button primitive. It is not "chrome styling for Stage 12's own bars" — **every icon button in the app conforms**, and the audit below is part of the stage, not optional polish.

**Shape follows grouping:**
- **One icon alone → circle.**
- **Two or more *related* icons → one capsule** (fully rounded ends), icons evenly spaced inside a single surface. Not N adjacent circles. Grouping is semantic, not spatial: in `icon-buttons-editor-accent.png` Undo keeps its own circle right next to a Share/`…` capsule, so being adjacent is not what merges controls.
- **Primary/confirm action → filled accent circle**, standing alone. Never absorbed into a capsule.
- Circles and capsules on the same row share the **same height**, so they sit on one optical line.

**Three interaction states, not two:**
- **Rest** — no background behind the glyph.
- **Hover** — subtle background behind *that one icon*, inset and rounded, visibly smaller than the containing surface.
- **Press** — same shape, **more prominent** background than hover.

Stage 9 shipped `SPRING_PRESS`/`PRESS_SCALE` (motion only). This adds the **background-color** half of the state machine, which does not exist yet.

**Painted size ≠ touch target.** This is the specific defect behind "the back button container seems too large": `HeaderCircleButton` paints a **44×44** circle because 44 was read as the HIG minimum. 44pt is the minimum *touch* target, not the minimum *painted* size — Apple paints these noticeably smaller and extends the hit area with `hitSlop`. Derive the painted diameter and the glyph size from the reference shots, keep the touch target ≥44 via `hitSlop`, and stop conflating the two.

**One glyph size everywhere.** The single deliberate exception is `FolderRow`'s `iconSizeForDepth()` (top-level 20px shrinking to 15px by depth 4) — that is intentional and stays.

**Two traps to design against explicitly:**
1. **Hover ≠ selected.** A persistent background can read as either. The "Aa" in the reference is ambiguous on this exact point. Give selected/active its own treatment, or every hovered button looks toggled on.
2. **Hover-only is a touch bug.** `NoteEditorPane.tsx:209` and `:235` use `hover:bg-muted` with *no* press state — on a phone or iPad those buttons have no visual feedback at all today. Fixing them is in scope.

**Audit — the current inconsistency this replaces** (measured 2026-08-21, `main` @ `b586da5`): **7 different container treatments** — `w-8 h-8 rounded-full border` (AvatarMenuTrigger), bare `44×44` (FolderRow chevron, FolderSidebar EditButton), bare `44×36` (FolderRow ReorderButton), `44×44 + bg-foreground/10` (HeaderCircleButton), `p-1.5 rounded-full active:bg-muted` (ManageAccountDialog, KeyStepScreen), `p-1.5 rounded-full hover:bg-muted` (NoteEditorPane ×2), `w-10 h-10 rounded-full bg-lime-500` (NoteListPane compose) — and **6 glyph sizes**: `w-4`, `w-4.5`, `w-5`, `w-6`, `w-7`, `w-[18px]`.

*(Superseded: the "radio dial slide to the right edge" concept from the original notes — replaced by the two-zone split above, matching iOS's own pattern rather than inventing a new one.)*

**📸 SCREENSHOTS** — under `dev-docs/design/iteration-2/floating-menu/`, rescanned 2026-08-21. Filenames below are what's actually on disk — some differ from the original planned names; use these, not the old ones.
- ✅ `desktop-top-bar-groups.png`
- ✅ `desktop-minimize-restore-states.png`
- ✅ `ipad-collapsed-groups.jpeg` (planned as `.png`, shipped as `.jpeg`)
- ✅ `ipad-expanded-groups.jpeg` (planned as `.png`, shipped as `.jpeg`)
- ✅ `mobile-navbar-default-aa-undo-redo.png`
- ✅ `mobile-aa-submenu-open.png`
- ⬜ `mobile-scrolling-bar-collapsed.png` — **still missing**, only the expanded state was shot. Fall back to Apple Notes for the collapsed state.
- ✅ `mobile-scrolling-bar-expanded.png`
- ✅ `formatting-toolbar-desktop.png`
- ✅ `find-in-note-desktop.png`
- ✅ `find-and-replace-in-note-desktop.png` (renamed from planned `find-replace-desktop.png`)
- ✅ `mobile-find-in-note.png` (renamed from planned `find-in-note-mobile.png`)
- ✅ `mobile-find-and-replace-in-note.png` (renamed from planned `find-replace-mobile.png`)
- ✅ `mobile-find-and-replace-menu-in-note.png` — extra shot not in the original plan: the find/replace mode switcher

**The icon-button reference shots** — supplied 2026-08-21 (review 4), authoritative for the icon-button system above:
- ✅ `icon-buttons-groups-light.png` — round compose button · capsule of `Aa` / checklist / table / paperclip, with `Aa` showing the inset rounded-square hover background · capsule of Share / `…`
- ✅ `icon-buttons-groups-dark.png` — the same row in dark mode
- ✅ `icon-buttons-editor-accent.png` — round Back · **round Undo, on its own** · capsule of Share / `…` · **filled accent circle with a checkmark**, the pattern Stage 11's select-mode Done button should match

**Grouping is semantic, not spatial** — read this off the shots rather than counting icons. Undo sits in its *own* circle immediately beside a Share/`…` capsule, so adjacency alone does not merge controls into a capsule; only *related* actions share one. "2+ icons → capsule" from the rules above means 2+ icons that belong together, and deciding what belongs together is a judgment call per bar, not a layout rule.

**Caveat on the three `mobile-find*` shots above:** taken in a resized iPad window standing in for a phone, not an actual phone screenshot. Close enough to use as reference — but sanity-check spacing and sizing against real phone width during Stage 12 rather than copying pixel-for-pixel; a few things in them are iPad-native layout artifacts, not intentional phone design.

**Learn:** floating/overlay chrome over a scrolling editor, keyboard-accessory positioning in RN, editor selection state driving contextual UI.

**Checkpoint:** the desktop bar floats correctly with the title overlapping only on scroll; all four minimize/restore combinations behave; the mobile Aa submenu and keyboard-docked scrolling bar both work on iOS and Android; Redo is genuinely absent until something's undone; Find and Find & Replace work on both platforms; search and New Note are functional again after Stage 11 removed them.

**Prompt:**

```
Create a branch `stage-12-menu-chrome` off main; merge back once the checkpoint passes. This is the largest stage in iteration 2 — map the spec to checkpoints in Plan Mode and propose sub-phases before executing, rather than attempting it in one autonomous run.

CONTEXT: Stages 9 (UI foundation), 10 (Folders), and 11 (List View) are merged. Use Stage 9's motion primitives and color tokens. IMPORTANT: Stage 11 REMOVED the search bar and New Note button from the desktop list pane on the understanding that this stage restores them in the editor chrome — that gap is real right now, and closing it is part of this stage, not optional polish.

SCREENSHOTS: check dev-docs/design/iteration-2/floating-menu/ during Plan Mode and view the files listed in the 📸 SCREENSHOTS block above — it is authoritative over my prose, and the filenames there are what's actually on disk (some were renamed from the original plan, and the iPad ones are .jpeg not .png). Only `mobile-scrolling-bar-collapsed.png` IS STILL MISSING — FOR THAT ONE, FOLLOW APPLE NOTES' OWN DESIGN. That is the explicit fallback for that gap only; don't invent a novel pattern where a reference does exist. The three `mobile-find*` shots were taken in a resized iPad window, not a real phone — treat the overall layout as authoritative but double-check spacing/sizing against actual phone width rather than copying pixel-for-pixel. Read the apple-design-system skill before proposing anything.

=== ICON BUTTON SYSTEM (do this FIRST) ===
Build the shared icon-button primitive before any bar that uses it, and apply it across the WHOLE app — this is not styling local to this stage's own chrome.
- Shape follows grouping: ONE icon = circle; TWO OR MORE grouped = a SINGLE CAPSULE with the icons spaced inside it (not N adjacent circles); a primary/confirm action = filled accent circle, standing alone. Circles and capsules on one row share the same height.
- THREE states per icon: rest (no background), hover (subtle inset rounded background behind that one icon), press (same shape, MORE PROMINENT than hover). Stage 9 gave you the motion half (SPRING_PRESS/PRESS_SCALE); the background-color half does not exist yet.
- PAINTED SIZE IS NOT THE TOUCH TARGET. HeaderCircleButton currently paints a 44x44 circle because 44 was taken as the HIG minimum — 44pt is the minimum TOUCH target. Paint smaller, restore >=44 with hitSlop. This is the actual fix for "the back button container seems too large."
- ONE glyph size everywhere. The ONLY exception is FolderRow's iconSizeForDepth() depth-based shrink, which is deliberate — keep it.
- Hover must never be the only affordance. NoteEditorPane.tsx:209 and :235 are hover-only with no press state today, so they are invisible on touch. Fix them.
- Keep hover and SELECTED visually distinct, or a hovered button reads as toggled on.
- Audit and convert every existing icon button; the plan file lists the 7 container treatments and 6 glyph sizes currently in the tree. Report anything you deliberately leave alone and why.

=== DESKTOP TOP MENU ===
Transparent, FLOATING OVER the editor (not a solid bar above it), with an Apple-Notes-style gradient drop shadow tinted to the current theme color. Icons only.
- On a NEW note the title must NOT be overlapped by the bar. Overlap happens only once the user scrolls.
- LEFT group: New Note, Maximize/Restore.
- CENTER group: the formatting toolbar (Apple desktop style), plus a CONTEXT-AWARE section that appears when the cursor is on a list item, adding indent, outdent, and strikethrough.
- RIGHT: group 1 is Share + Menu; group 2 is the search bar.

=== MINIMIZE / RESTORE ===
Behavior depends on folder-view and editor-view state, matching Apple Notes desktop. Four situations to get right:
- Folder view SHOWN: show the New Folder and minimize buttons on its right side; hide them from the list view.
- Folder view HIDDEN: show a restore button to the LEFT of the folder name and note count in the list view.
- Editor view, folder view shown: hide the list-view restore button while in folder view; also show List.
- Editor view, folder view minimized: show the list view with a maximize-editor button in the editor's left-side menu.
Build a small state matrix in your plan before implementing — this is the part most likely to produce a subtly wrong combination, and it's hard to spot by looking at one screen at a time.

=== MOBILE ===
TWO SEPARATE ZONES. Do not merge them into one bar.

1. TOP NAV BAR — fixed, standard nav-bar height, NOT floating:
   - Back button leftmost.
   - Immediately to its right, a grouped cluster: "Aa" button, Undo, Redo.
   - Tapping "Aa" drops a submenu directly below the nav bar with paragraph/text styles (Title, Heading, Subheading, Body — Apple Notes' Aa pattern). The keyboard stays visible.
   - REDO IS CONTEXTUAL: hidden or disabled until the user has actually undone something. Never a permanently visible dead button.
   - Right side: Share + Menu group. Menu's items include "Move Note" per list-view/mobile-move-to-folder-from-note-editor-menu.png — wire it to Stage 11's folder-picker component, don't build a second picker.

2. HORIZONTAL SCROLLING CONTEXT BAR — docked directly ABOVE THE SOFTWARE KEYBOARD, matching iOS's native in-context format selector position. Not a custom floating position, not attached to the nav bar.
   - Inline formatting icons: bold, italic, underline, strikethrough, checklist, bulleted list, numbered list, indent, link, table, image.
   - Scrolls horizontally on overflow. No wrapping. Snaps to a clean icon edge rather than stopping mid-icon.
   - EXPANDABLE: tapping a dedicated affordance grows it upward into a taller panel revealing grouped/secondary options. Still docked above the keyboard, PROPORTIONAL height, not full-screen. Use Stage 9's spring primitives for expand/collapse.
   - When the cursor context changes while the bar is visible (e.g. moving from a list item to plain text), the icon set swaps IN PLACE without attention-grabbing motion — no bounce, no flash. The user shouldn't be interrupted, but should find the right icons where they expect them.

=== iPAD ===
Inherits the DESKTOP left/center/right grouping and the same controls — NOT the phone's two-zone split — but COLLAPSIBLE-FIRST: groups that sit permanently expanded on desktop start collapsed and expand on tap.
- "Aa" IS PINNED TO THE TOP NAV BAR on iPad, matching desktop's persistent placement rather than the phone's keyboard-adjacent bar.
- Touch affordances are kept even with a Magic Keyboard attached; nothing may be hover-only.
- Propose which groups default to collapsed versus stay visible, and the expand trigger (per-group tap vs. a single overflow affordance), against the iPad screenshots if they exist. Account for portrait, landscape, AND Split View — a layout that only works full-screen landscape is not done.

=== FIND IN NOTE / FIND & REPLACE ===
BOTH platforms get both features. Separate layouts per platform — replace-field entry and match-navigation controls cannot share a layout across those widths.
- Find: match highlighting in the editor, match count, next/previous navigation.
- Replace: replace-one and replace-all.
- Mobile has to coexist with the keyboard and the scrolling context bar; say how you resolved that, since three things competing for the bottom of the screen is the obvious failure mode here.
- Search runs entirely against decrypted local content. Confirm no path sends the query or the note anywhere.

=== VERIFY ===
- Screenshot the desktop bar on a new note (title not overlapped) and mid-scroll (overlapping), proving the difference.
- Walk all four minimize/restore combinations and screenshot each.
- Confirm Redo is genuinely absent/disabled before any undo, and appears after one.
- Confirm the mobile scrolling bar tracks the keyboard correctly on BOTH iOS and Android, including when the keyboard dismisses.
- Confirm context-swap in the scrolling bar doesn't animate distractingly.
- Confirm search and New Note are reachable again on desktop after Stage 11 removed them from the list pane.
- Test iPad in portrait, landscape, and Split View.
- Screenshot everything at default and at an accessibility text size (Stage 9's scaling must still hold).
- tsc --noEmit and lint clean.
```

---

## Stage 12.5 — LIVE CHECKLIST (started 2026-08-22, branch `stage-12.5-sheets-and-dnd`)

Updated as each item lands, so progress is inspectable in a diff rather than
only in a chat log.

- [x] **1. Four-library native rebuild.** ✅ Done. `ExpoBlur (15.0.8)`,
      `Pulsar (1.7.0)` + `PulsarHaptics (1.4.0)`, `ReactNativeBottomSheet
      (0.16.2)` all installed; `RNPulsarSpec` and `ReactNativeBottomSheetSpec`
      codegen ran. `react-native-reanimated-dnd` has no native code, correctly.
      Sign-in state survived the overwrite install.
      **`expo run:ios` exits 1 even on success** — it calls `osascript` to bring
      the Simulator window forward, which is the same Automation permission that
      blocks rotation. The build and install both completed; launch with
      `xcrun simctl launch` instead of trusting the exit code.
      *(original item below)*
- [ ] ~~**1. Four-library native rebuild.**~~ `react-native-pulsar` and `expo-blur`
      have been in `package.json` since 12a without ever being in the binary;
      this stage adds two more, so one prebuild pays for all four.
      `LANG` is EMPTY in this shell — it must be a UTF-8 locale or `pod install`
      dies on an ASCII-8BIT encoding error.
- [x] **2. `react-native-pulsar` resolves.** ✅ Proved, not assumed: a temporary
      `console.log` in the lazy loader printed `[haptics] RNPulsar loaded` on a
      real button press, then was removed. Worth doing explicitly because the
      guarded require is designed to swallow exactly this failure.
      *(original item below)*
- [ ] ~~**2. `react-native-pulsar` resolves.**~~ Not "haptics feel right" — no
      simulator has a Taptic Engine. The check is that `RNPulsar` is registered,
      which the lazy require currently swallows.
- [x] **3. `FolderPickerSheet` on the native bottom sheet.** ✅ Scrim, rounded
      corners, correct height, disabled rows intact, and drag-to-dismiss — which
      the Gluestack version never had — verified working.
- [x] **4. `SettingsDialog` on the native bottom sheet.** ✅ Sub-view navigation
      (Settings → Appearance) verified; the sheet keeps its height rather than
      resizing under the thumb as you push in.
- [x] **5. Drag-to-reorder folders.** ✅ Done — built directly on
      gesture-handler + Reanimated 4, **no dependency**. Adam chose option 1,
      2026-08-23.

      `react-native-reanimated-dnd` was tried first and is unusable at BOTH
      published versions:
      - `1.1.0` peers on `react-native-reanimated >= 3.0.0` but calls
        `useAnimatedGestureHandler`, which **Reanimated 4 removed**. It
        installs, type-checks and builds, then throws
        `useAnimatedGestureHandler is not a function` from `useSortable` the
        moment edit mode renders. The peer range is simply wrong.
      - `2.0.0` requires `react-native-reanimated >= 4.2.0`; Expo SDK 54 pins
        `~4.1.1` (we are on 4.1.7) and `expo install --check` treats that as
        current.

      What shipped instead:
      - `lib/notes/reorder.ts` — `moveToIndex`, `targetIndexFor`, `rowShift`,
        with 16 tests. The last two are worklets; all three are pure, which is
        the only reason any of this is testable (see below).
      - `lib/powersync/folders.ts` — `moveTopLevelFolderToIndex`, renumbering
        the level contiguously from 0 in one transaction. Deliberately NOT the
        swap `moveTopLevelFolder` uses; see the Decisions Log.
      - `components/ReorderableFolderList.tsx` — the pan, the displacement, and
        the settle.
      - `FolderRow` gains `dragHandle`, which replaces the up/down arrows in
        edit mode, and publishes `onMove` as VoiceOver `moveUp`/`moveDown`
        actions so reordering does not become sighted-only.
      - The sidebar's `ScrollView` is now gesture-handler's, so
        `blocksExternalGesture` has a recogniser to outrank.

      **Children are hidden in edit mode.** Load-bearing, not tidiness: the
      drag maths assumes every row is one row tall, and an expanded parent is as
      tall as its subtree. Reordering was already top-level-only, so this also
      stops the list offering rows that would refuse to be dragged.
- [x] **6. Checkpoint.** `tsc` clean, **167/167 tests** (151 + 16), `expo lint`
      at the 8-warning / 0-error baseline. Both sheets behave as before with no
      Gluestack workaround left in either file. Skills stays pinned and has no
      grip — confirmed on iPhone 17 Pro. Drag proved end to end in the browser
      (table below).

      **The last checkpoint line is now observed.** "The new folder order
      survives a sync round-trip" could not be proved here — injected simulator
      touches never reach a gesture-handler recogniser — so it stood as a sound
      argument rather than an observation: `sort_order` is `column.integer` in
      `lib/powersync/schema.ts`, the `user_folders` bucket is
      `select * from folders`, so the column replicates and a `sort_order`
      UPDATE enters the CRUD queue exactly as a rename does. **Adam confirmed it
      by hand on 2026-08-27, dragging a folder on the iPhone 17 Pro: worked
      fine.** Stage 12.5 is complete.

**The gesture cannot be tested on a simulator, so it was tested in a browser.**
Injected `simctl` touches drive React Native's own responder system but never
fire a `UIGestureRecognizer`, so every gesture-handler recogniser in the app is
invisible to them. On web, gesture-handler listens on pointer events — which
*can* be synthesised. Four folders (Alpha/Bravo/Charlie/Delta) created in the
session-only web database, then:

| Case | Result |
|---|---|
| Alpha (0) dragged +132px = 3 rows | lands at index 3 ✅ |
| Delta (2) dragged −88px = 2 rows | lands at index 0 ✅ |
| First row dragged −400px | clamps, no write ✅ |
| Last row dragged +400px | clamps, no write ✅ |
| Any row dragged 6px (under half a row) | springs back, no write ✅ |
| Mid-drag | neighbours slide out of the way, gap opens at the target ✅ |

The order re-renders from `SELECT … FROM folders ORDER BY sort_order`, so the
list changing IS proof the write landed rather than a local animation.

What this does **not** prove, stated plainly: whether the pan wins against
iOS's scroll view on a real finger. Two independent defences are in
(`blocksExternalGesture`, plus `scrollEnabled={false}` for the duration), and
haptics still need a physical device — no simulator has a Taptic Engine.

**A regression this caught, unrelated to the drag:** the browser run opened on a
red error screen — `(0, _reactNativeWebDistIndex.codegenNativeComponent) is not
a function`. `@swmansion/react-native-bottom-sheet` is a Fabric component with
no web implementation, so items 3 and 4 had silently taken web from working
(12g) back to not booting. Fixed with `components/ModalSheet.tsx` /
`.web.tsx` — a platform seam, because the throw is at *import*, so a guard at
the call site could never have caught it. The web sheet keeps the presentation
and the prop shape and honestly drops drag-to-dismiss.

**Two traps found on the device, both silent:**

*Numeric detents are POINTS, not fractions.* `resolveDetent` returns a number
unchanged, so `detents={[0, 0.8]}` opened the sheet **eight tenths of one point**
tall. It rendered nothing and threw nothing — the menu just closed and the screen
looked unchanged. Now `useWindowDimensions().height * 0.8`, reproducing the
`h-4/5` the Gluestack version had.

*A native sheet has no scrim unless you name one.* The Gluestack version had
`<ModalBackdrop />`; without `scrimColor` the sheet presented at the right height
and was invisible against the app, because both are `bg-background` and the
dimming was the only thing separating them.

**Version call, made not escalated — SUPERSEDED 2026-08-23** (the package is
gone; kept because the reasoning is why we did not bump Reanimated either):
`react-native-reanimated-dnd@1.1.0`, not 2.0.0. 2.0.0 peers on `react-native-reanimated >= 4.2.0` and Expo SDK 54 pins
`~4.1.1` (`expo install --check` agrees). Bumping the core animation library —
which the motion primitives, the icon button, the format bar and the vendored
swipeable all sit on — to satisfy folder reordering is the wrong way round. Same
reasoning as pinning `@powersync/web@2.1.0` rather than dragging
`@powersync/common` up under native's feet.

---

## Stage 12.5 — Native sheets + drag-to-reorder folders (NEW, added 2026-08-21)

Two adopted libraries, batched into one stage because both are chrome-level swaps over
things Stage 12 will just have finished styling. Doing either earlier means restyling twice.

**`@swmansion/react-native-bottom-sheet`** replaces the Gluestack `Modal` bottom-sheet
idiom in `components/FolderPickerSheet.tsx` and `components/SettingsDialog.tsx`. This
retires all three documented Gluestack traps at once, rather than continuing to work
around them in every new sheet:
- `bg-background` having to be spelled out or the sheet renders black,
- `ModalBody` being unusable (it is a ScrollView whose className becomes its own style),
- children being hoisted above the providers, so `useTheme()`/`useVault()` throw inside
  and every sheet has to take its data as props.

**`react-native-reanimated-dnd`** replaces the up/down arrow buttons in
`components/FolderSidebar.tsx`'s edit mode with real drag-to-reorder.
- **Not a Software Mansion library** — a community project built on Reanimated. Called
  out because the rest of this batch is first-party and the support expectations differ.
- Scope stays **top-level only**, per Stage 10's logged decision. Nested drag reopens a
  settled question and is not in this stage.
- `swapFolderOrder` (`lib/powersync/folders.ts:330`) already swaps `sort_order` between
  two rows and is the right primitive to drive from a drop — don't renumber the list.

**Checkpoint:** the folder picker and settings sheets behave identically to today with no
Gluestack workarounds left in either file; folders reorder by drag, the new order survives
a sync round-trip, and Skills stays pinned and undraggable.

---

## Stage 13 — Web Platform Parity + PWA

**Direction (decided):** build web out properly as an **installable, offline-capable PWA** — not a degraded read-only view. Technology choice is open, judged on three criteria in this order: performs well, stays simple, and integrates with the existing Expo/PowerSync/Supabase stack without undue complexity. Don't introduce a parallel architecture to make web work.

**⚠️ PHASE 0 IS DONE. It was run on 2026-08-21 and the answer is GO** —
`dev-docs/web-at-rest-findings.md`, with a 2026-08-25 addendum re-proving it on
this app's own pipeline. It sat on an unmerged branch (`spike/powersync-web-at-rest`,
off Stage 10) that nothing in this plan pointed at, so two later sessions
believed it still needed running. **This is the third time on this project that
work has existed only in a commit message.** The prompt below is kept because it
is the brief the spike answered, not because it is still to be run.

**All four questions are now answered (2026-08-25) and Phase 1 is unblocked.**
Encryption is mandatory, the bundle cost is approved, there is no web lock
screen, and the public guarantee wording is settled — see the findings doc and
the Decisions Log.

**Phase 0's original framing (superseded, kept for the reasoning).** The question is no longer
"can web run at all" — Stage 12g settled that — but **what web is allowed to
write down**. Web today deliberately persists *nothing*: an in-memory VFS and an
in-memory key store, so a refresh is a new session with an empty database. That
was chosen precisely so this spike would not be pre-empted. Phase 0's only
deliverable is a written answer plus a go/no-go, before any UI time is spent.

**What Stage 12g already settled, so the spike does not re-ask it** (main @
`a5ccd9f`):
- Web **boots and runs the real app**. The `Appearance.setColorScheme` failure is
  fixed; so are `expo-secure-store` and `expo-navigation-bar`.
- `@powersync/web` is installed and working, **pinned to 2.1.0** — the last
  release whose peer range accepts the `@powersync/common@2.0.0` that the native
  SDK pins. 2.2.0 would drag the shared core up under native's feet.
- The platform split already exists and is small:
  `lib/crypto/secureStorage.ts` / `.web.ts`, `lib/powersync/openDatabase.ts` /
  `.web.ts`, `lib/powersync/migrateToEncrypted.web.ts`. `lib/crypto/` proper and
  `VaultContext` are shared **unchanged**.
- The wa-sqlite worker is pre-bundled and committed in `public/@powersync/`,
  with `metro.config.js` aliasing `@powersync/web` to its
  `index.react_native_web.js` build. Running wa-sqlite *in the tab* is a dead
  end under Metro — `import.meta` in the Emscripten module kills the bundle.

**A correction the spike must start from.** This stage's original brief said web
"has no SQLCipher equivalent, so whole-file encryption can't simply be ported."
**That is wrong.** `@powersync/web` accepts an `encryptionKey` and encrypts the
database file with **ChaCha20 via SQLite3MultipleCiphers** (see its README, and
`encryptionKey` in `db/adapters/options.d.ts`). Whole-file encryption on web is
available and supported. So Phase 0's real question is not *whether* the bytes
can be encrypted — it is **where the key lives in a browser**, which is the part
that has no Keychain to hide behind.

## Stage 13f — THE WEB EDITOR IS THE REAL EDITOR (branch `stage-13f-web-editor`)

`components/RichEditor.web.tsx` is **deleted**. Web now runs the same
`RichEditor.tsx` as native, on the same `react-native-enriched-html` — whose web
build turns out to implement the identical imperative API (`focus`, `blur`,
`setValue`, `setSelection`, `getHTML`, and every `toggle*`). The override existed
only because the import used to break the bundle, which 13e fixed.

### Verified in a browser

- The editor loads: ProseMirror `contenteditable`, no "Plain text on web" badge.
- **Text styles and Checklist are now ENABLED**; Table and Attach stay disabled,
  which is correct — those are the genuinely unsupported ones.
- Typing persists as real HTML: `<h1>Shopping list</h1>` came back after a
  reload, with Stage 12d's first-line-is-a-heading rule applied.
- Checklist produces a real `<ul data-type="checkboxList">` with a live checkbox,
  and it survives a reload — formatted HTML round-tripping through the encrypted
  OPFS database.
- Native re-checked on iPhone 17 Pro: boots, renders its heading and bullet.

### The crash this uncovered, which is the finding worth keeping

Deleting the override made the app die on the **first keystroke** with
`Cannot read properties of null (reading 'commands')` from tiptap's `Editor`.

The cause is a prop that means two different things on the two platforms. The
web build creates its editor with `useEditor({...}, [tiptapContent, extensions])`
— so **changing `defaultValue` destroys and recreates the whole editor.** On
native, `defaultValue` is what it sounds like: taken at mount, inert afterwards.

That turned every keystroke into a teardown: typing saves → the save round-trips
through SQLite and the watch → `initialContent` comes back changed →
`defaultValue` changes → tiptap rebuilds → `ref.current` points at a destroyed
instance → the echo ledger's next `setValue` throws.

The fix is to freeze the seed at mount, which is what the prop already means. It
is safe precisely because `NoteEditorPane` mounts the editor with
`key={selectedNote.id}`, so a different note is a different mount; within a note,
genuine remote edits arrive through `applyRemote` → `setValue`, the path built
for exactly that. Native is unaffected — it ignored later changes to that prop
anyway.

`lib/notes/plainTextBody.ts` is now unused by the app. Kept and annotated rather
than deleted: Stage 15's export is the obvious next consumer of an
HTML-to-plain-text projection, and it is already tested.

---

## Stage 13e — WEB PARITY AUDIT (branch `stage-13e-web-parity`)

Web is much closer to native than this plan assumed. What was actually
exercised in a browser, and what was not, kept separate on purpose.

### Verified working on web

| Area | Evidence |
|---|---|
| Folder CRUD + context menu | create/rename/subfolder driven through the UI |
| Drag-to-reorder folders | Stage 12.5 — exact landing slot, both clamps, drop-in-place |
| **Find & Replace** | ⌘F opens it; "alpha" over three occurrences reports **3 matches**; Previous/Next/Replace/Done all present |
| Desktop chrome | **New Note and Search are both present** — this closes the plan's "reconcile where Stage 12 landed them" item. Confirmed, not re-decided. |
| Unsupported formatting | present and genuinely `aria-disabled="true"`, `tabindex="-1"` — the Stage 12 decision to show them greyed rather than hide them, working as specified |
| Persistence + encryption + lock | Stages 13a/13b |
| PWA head tags in dev | manifest linked, `theme-color`, `viewport-fit=cover` |

**A bug I nearly reported that was not one.** ⌘F looked broken because the body
text contained no "Find" — the string is a *placeholder*, not visible text.
Checking the DOM instead of the rendered text showed the bar had opened
correctly the first time. Worth recording as a reminder that
`innerText.includes(...)` is a weak assertion about a UI.

### Not exercised in this pass, and not claimed

Note-row swipe actions, trash restore/purge, sign-in, and share/export. The
swipe path uses the same gesture-handler machinery the folder drag already
proves on web, but "the mechanism works" is not the same claim as "this feature
works", and it is not made here.

### The editor: the blocker is gone

Web has a plain-text editor because Stage 12b had to keep the whole `@tiptap`
chain out of the bundle. **That blocker is a resolution artefact and it is now
fixed** — the library's web build loads:

```
LOADED. exports: EnrichedTextInput, EnrichedText
```

npm hoisted half the tiptap stack to the top level and left half nested inside
`react-native-enriched-html`, and the two halves could not see each other:
hoisted `@tiptap/extension-history` imports `@tiptap/extensions`, which exists
only nested. **Not a version conflict** — every copy in the tree is 3.27.1.

The fix hands Metro a resolution ORIGIN inside the library rather than a path,
so Node's own upward walk finds nested packages nested and the top-level ones at
the top. Two earlier attempts are recorded in `metro.config.js` because each
looked right: a single alias produced whack-a-mole across a dozen packages, and
redirecting names to paths broke subpath exports
(`@tiptap/extensions/placeholder`). **No new dependency** — only a path.

**Deliberately stopped here.** The alias is inert until something imports the
library on web; wiring `RichEditor.web.tsx` onto `EnrichedTextInput` is a real
sub-phase — props API, HTML in/out, the echo ledger, formatting commands, and
Find's selection integration — and it touches the note content path, which is
encrypted and merge-sensitive. That is not work to start at the end of a long
session. It is now unblocked and costed rather than unknown.

---

## Stage 13d — LIVE CHECKLIST (branch `stage-13d-pwa`)

- [x] **1. Manifest, icons, head tags.** `public/manifest.webmanifest`, 192/512
      plus a maskable 512 padded into the safe zone, and the `<head>` tags an
      installable app needs.
- [x] **2. Service worker** (`public/sw.js`) — network-first for navigations so
      a deploy is picked up rather than pinned by a cached HTML entry;
      cache-first for hashed assets. Precaches `/@powersync/worker.js`
      **explicitly**, because the worker fetches its own wasm and a
      "cache what the page requested" strategy misses it — without which the
      app launches offline and then cannot open its database, which is worse
      than saying it is offline. Notes are never cached: a service worker cache
      is plaintext, and caching a note response would quietly undo 13a.
- [x] **3. Install prompt.** `beforeinstallprompt` captured at **module scope**,
      not in the hook — it fires once, early, usually before React has mounted
      anything, and a hook that only starts listening on mount misses it and
      reports "not installable" forever. The Settings row appears only when the
      browser has genuinely offered an install, so it is absent on iOS Safari
      rather than present and inert.
- [x] **4. `navigator.storage.persist()` on install.** 13a measured it returning
      false on a bare origin; an installed PWA is the strongest engagement signal
      Chrome accepts, so this is the moment it is likely to be granted.
- [x] **5. `npm run build:web`**, and 199 tests.

**`app/+html.tsx` does not work here, and failed silently.** It is the documented
way to control the HTML shell and is only read by Expo's STATIC renderer; this
app builds `web.output: "single"`, where Expo emits a fixed template and never
looks at it. Written, exported, ignored — the built `index.html` came out as the
stock template with no manifest link. Switching to `output: "static"` would fix
it and would also turn on per-route prerendering, which an auth-gated app whose
providers touch browser APIs at module scope should not take on for four meta
tags. So the tags are data in `lib/pwa/headTags.ts` with two consumers that
cannot drift: a runtime injector for `expo start --web`, and a post-export script
for the shipped page. Every tag carries a `replaces` selector, which is what
makes the injection idempotent — proven by running it twice and diffing.

**A registration that registered nothing, silently.** `registerServiceWorker()`
deferred to `window.addEventListener('load', …)`. In the built app the bundle is
deferred and this module is reached through expo-router's lazy layout, so by the
time it evaluates the document is already `complete` — the listener was attached
to an event that had already fired and waited forever. No error, no worker, no
offline support, nothing in the console. Found by reading `document.readyState`
from the page rather than trusting the code. It now registers immediately when
the document is already complete.

### Cannot be verified here, and this one is large

**Service workers are disabled in this browser pane.** Registering a
*trivially valid empty worker* fails with the identical error as registering a
file that does not exist — `An unknown error occurred when fetching the script`
— so the browser is not fetching at all. That is the environment, not the code.

Unverified as a direct consequence: worker registration, the offline shell,
`beforeinstallprompt` (which requires an active worker with a fetch handler), the
install row appearing, and `persisted()` flipping to true. **Adam's own Chrome
settles all five at once:** `npm run build:web`, serve `dist/` over HTTP/1.1
(Python's `http.server` speaks 1.0 and Chrome's worker fetch dislikes it), then
install from the omnibox.

Verified instead: the manifest is linked and parses with the right name, display
and three icons; every asset resolves; the head injection is idempotent; `sw.js`
is syntactically valid and served as `text/javascript`; and 7 tests cover the
head-tag invariants including the two-viewport trap.

---

## Stage 13c — POST-SHIP FIXES (2026-08-28): three bugs between a written row and a synced one

Settings shipped in 13a–13c, type-checked, tested, and did not sync. Adam found
it on two simulators: notes moved between phone and tablet, appearance never
did. It was three independent faults stacked, each individually silent.

**1. The upload handler was never written.** `uploadEntry` in
`lib/powersync/connector.ts` switches on the table name and had cases for
`notes` and `folders` only. Every `user_settings` op hit `default:`, logged a
dev warning, and was SKIPPED — and because the skip returned cleanly, PowerSync
treated the op as delivered and cleared it from the queue. Rows were written
locally, shown in the UI, and silently discarded on the way out. The guard I
wrote in Stage 11 predicted this exactly ("a new synced table added later gets a
loud dev warning here"); the warning fired for weeks in a Metro log nobody reads.

**2. Adoption only looked at the mirror.** `adoptLocalSettings` read
`notes.settings.<key>` and skipped anything absent — which is every preference
set BEFORE 13c, since those live in the legacy key. So the devices that most
needed adopting were exactly the ones it ignored. Fixed to fall back to
`LEGACY_KEY`, and to write the mirror as it goes.

**3. Reconcile ran once, at boot.** The initial sync delivers the account's rows
*after* that reconcile has already run, so nothing ever looked at them; the next
launch lost the same race identically. Notes and folders never hit this because
they render from live watch queries — settings are read once into a mirror, so
the watch had to be spelled out. Added `watchSettings()`.

A fourth, found in the fix: importing `LEGACY_KEY` through `syncedSettings`'
re-export left it `undefined` at module-init time (`TypeError: Cannot convert
undefined value to object`). Now imported straight from the pure module.

**Verified end to end, and the disambiguation matters.** iPhone set to Dark;
iPad's *system* appearance set to **Light**; the iPad app renders **dark**. A
device following its own system and a device honouring a synced preference look
identical until you make them disagree — the same trap that made the earlier
legacy-fallback check worthless.

Also new: `lib/settings/settingKeys.ts` — keys and the legacy map in a pure
module, so `LEGACY_KEY` is covered by tests rather than by hope. 202/202.

---

## Stage 13c — LIVE CHECKLIST (branch `stage-13b-web-lock`, continues 13b)

- [x] **1. Appearance, app theme and bullet style are account settings.**
      `lib/settings/appearanceSettings.ts`; `ThemeContext` reads and writes
      through it instead of three raw `secureStorage` keys.
- [x] **2. Legacy fallback.** The pre-13c keys (`notes.appearance.v1`,
      `notes.theme.v1`, `notes.bulletStyle.v1`, bare strings) are read when the
      synced mirror is empty — which is every existing device on the day this
      ships. Without it, everyone silently reverts to system/flat/dash.
- [x] **3. A cross-provider subscription.** `ThemeProvider` sits OUTSIDE
      `VaultProvider` (the appearance must settle before anything paints), yet
      only the vault side has a database to reconcile from. So the reconcile
      publishes and the theme subscribes; a context cannot carry this in the
      direction the data flows.
- [x] **4. Local choices are adopted at first sign-in.** `adoptLocalSettings`
      runs *before* `reconcileSettings`, pushing up only keys the account does
      not already have — an existing row is a choice from another device and
      outranks whatever this one did while signed out.
- [x] **5. Checkpoint.** `tsc` clean, **192/192**, lint at the 8-warning
      baseline. On web: switching to Light applies, writes
      `notes.settings.appearance.v1`, and survives a hard reload. Native boots
      and decrypts throughout.

**The camelCase trap, caught by a test rather than a stuck queue.** The obvious
key for the bullet style is `bulletStyle.v1`. The migration constrains keys to
`^[a-z0-9]+(\.[a-z0-9]+)*$`, so that key type-checks, writes to the local mirror
happily, and is then **rejected by Postgres on upload** — where a constraint
violation is not classified as structural and therefore retries forever, jamming
every operation queued behind it. It ships as `bulletstyle.v1`, and
`isValidSettingKey` now fails the build instead of the sync.

**A verification that proved nothing, and what replaced it.** The legacy fallback
was checked by launching the app on an iPhone running the previous build: it came
up dark, the device was dark, and that looked like proof. Flipping the simulator
to light flipped the app too — so that device's stored preference had been
`'system'` all along, and `'system'`, `'nothing stored'` and `'fell back
correctly'` are indistinguishable on screen. The observation had **no power to
detect the bug it was meant to catch.** The precedence moved into a pure
`resolveSetting()` with six tests, including that exact pair.

---

## Stage 13b — LIVE CHECKLIST (branch `stage-13b-web-lock`)

- [x] **1. `user_settings`, applied to DEV.** Key-value, one row per setting, with
      a deterministic `(user_id, key)` row id. Every constraint proven to reject
      what it should; RLS on with four owner-only policies; in the powersync
      publication with a role grant; PowerSync restarted clean and replicates it.
- [x] **2. `supabase db push` to LIVE — done by Adam, 2026-08-27.** The CLI
      prompts for the database password interactively, which is a credential I
      will not enter. **Verified afterwards rather than assumed:** the live
      PostgREST endpoint returns `42501 permission denied` for `user_settings`
      under the anon key — byte-identical to how `folders` behaves, and exactly
      right, since the migration grants to `authenticated` only and never to
      `anon`. A missing table would have returned `PGRST205`.

      ⚠️ **Still outstanding on live, and it is a dashboard action:**
      `powersync/sync-streams.yaml` is the reviewable copy, not the deployed
      one — `docs/two-stacks.md` says the PowerSync Cloud dashboard is the
      source of truth for what is actually running. The `user_settings` stream
      has to be added there or live devices sync notes and folders but never
      settings, with every container reporting healthy.
- [x] **3. Both sync configs.** `sync-rules.yaml` (dev, `bucket_definitions`) and
      `sync-streams.yaml` (live, Sync Streams edition 3). Different formats, both real.
- [x] **4. Settings sync with a boot mirror.** Table is the source of truth;
      `secureStorage` holds what boot reads. Lock settings moved out of `vault.ts`
      because calling the settings layer from there closes a real import cycle
      through `powersync/db.ts`.
- [x] **5. Gate crypto.** `HKDF(scrypt(PIN, salt) ‖ browserSecret)`, 10 tests. The
      PIN is never the only input — see the Decisions Log.
- [x] **6. WebAuthn PRF + passcode gate**, attempt counter, self-destruct.
- [x] **7. Locking wipes the keys.** `lockBehaviour.web.ts` closes the database
      then zeroes the keys; native's is an empty function, deliberately.
- [x] **8. PIN pad, lock screen and setup dialog.**

### Verified in a browser, end to end

| Check | Result |
|---|---|
| Enable lock → set PIN → enrol | ✅ |
| Plain device key after enrolment | ✅ **gone**; only the gate-wrapped copy remains |
| KEK | ✅ `extractable: false`, AES-GCM |
| Every stored item | ✅ `{iv, ciphertext}` — no plaintext |
| Reload | ✅ boots **locked** |
| Correct PIN | ✅ unlocks, and the canary note decrypts from the encrypted DB |
| Wrong PIN | ✅ rejected, counter decrements 9…1 |
| 10 wrong PINs | ✅ gate self-destructs |
| Disable → re-enable | ✅ gate retired, plain key restored, fresh enrolment |
| Old blob after the KDF retune | ✅ still opens — stored params are honoured |
| Native regression | ✅ iPhone 17 Pro boots and decrypts throughout |

**Three bugs found by running it, none of which the compiler could see:**

1. **The lock toggle was disabled until a gate existed** — and the toggle was the
   only way to create one. `getLockCapability()` returned `'none'` when nothing
   was enrolled, which is right on native and a dead end here. It now reports
   what *could* be enrolled; `'none'` is unreachable on web, because a PIN can
   always be set.
2. **Self-destruct bricked the app.** Destroying the gate removes the only copy
   of the device key, but the lock setting stayed `enabled` — so the next boot
   returned to a keypad that could never succeed. The notes were gone *and*
   there was no way past the screen. The wipe now also disables the lock and
   resets local data, which is what its own message already promised.
3. **The KDF was 7x too slow**, and the browser could not be trusted to say so.
   See the Decisions Log.

### Not verified, and it cannot be from here

**The WebAuthn/passkey path.** This browser exposes no platform authenticator, so
`isBiometricGateAvailable()` is false and the setup dialog correctly offered only
a PIN — which does exercise the fallback, but never the passkey. Enrolment,
PRF evaluation and passkey unlock are written and type-check; **none has ever
run.** Adam's Mac (Touch ID) or phone is the only place that can settle it.

---

## Stage 13a — LIVE CHECKLIST (branch `stage-13a-web-persistence`)

- [x] **1. `secureStorage.web.ts` is an encrypted IndexedDB store.** Every value
      crossing the seam is AES-GCM encrypted under a **non-extractable** WebCrypto
      key whose handle lives in IndexedDB — `exportKey()` on it throws. Applied at
      the seam rather than to the device key alone, so the Supabase session token
      and the plaintext-endpoint tokens are covered without opting in.
      `isSessionOnly` → false.
- [x] **2. The database persists and is encrypted.** `OPFSCoopSyncVFS`, the
      `encryptionKey` that `db.ts` was already passing and this file ignored, and
      **a missing key is now a throw** — Adam's "mandatory" made structural.
      `isSessionOnlyDatabase` → false.
- [x] **3. `powersync:assets` keeps the ciphers WASM.** The old prune deleted
      `mc-*`, which *is* the encryption build; as committed the app could not have
      opened an encrypted database whatever the code asked for. Now exactly one
      wasm ships: `mc-wa-sqlite-*.wasm`, 1.31 MB. Directory went 1.5 MB → 1.7 MB,
      the **+0.2 MB net** that was approved.
- [x] **4. `wipeLocalDatabase()` is async on both platforms**, awaited at all four
      `VaultContext` call sites.
- [x] **5. Two badges stopped lying.** `RichEditor.web.tsx` had *"this session
      only"* **hardcoded**, not read from the flag, so it survived the change and
      confidently told the user the opposite of the truth. Caught by reading the
      screen. `SyncRecoverySection`'s footnote now has web-specific wording.

### Verified in a browser, on the bytes

| Check | Result |
|---|---|
| Note survives a hard reload | ✅ text and folder intact |
| `notes-v2.db` header | ✅ zeros — no `SQLite format 3` magic |
| Note-body canary on disk | ✅ not readable |
| **Scanner self-test** | ✅ finds a canary in a file that really is in the clear |
| `note_sync_base` plaintext row | ✅ plaintext **in** the db, absent **on disk** |
| Field encryption still on | ✅ `notes.body` reads `enc:v1:…` |
| Reset: close → wipe | ✅ `.db`, `-wal`, `-journal` all gone; reinit gives 0 notes |
| Native regression | ✅ iPhone 17 Pro boots, 4 notes decrypt |

**`note_sync_base` needed making non-vacuous.** The table was *empty* — nothing had
synced — so "the canary is not on disk" would have proved nothing. A plaintext row
was inserted deliberately, confirmed plaintext by reading it back through SQL, and
only then looked for in the file. A check that passes because the table is empty is
worse than no check.

**A silent failure found by verification, then fixed.** Wiping *without* closing
the database first returned cleanly and deleted **nothing** — OPFS refuses to
remove a file with a live access handle, and a bare `catch {}` turned that into a
successful-looking no-op. On a control whose whole job is destroying data, that
means telling a user their notes are gone when they are not. `NotFoundError` is now
the only swallowed error; everything else throws. Re-verified both ways.

### Not passing, and it is not a code defect

`navigator.storage.persisted()` is **false**. The call is made; Chrome refuses it
on a bare `localhost` origin — `persist()` resolves `false` even called by hand
from the console. Chrome grants persistence on engagement signals (installed PWA,
bookmark, repeated use), so this is expected to flip when the PWA slice lands.
Until then a dev build genuinely is evictable, which is worth knowing rather than
papering over.

---

**Phase 1+ (blocked on Phase 0's outcome):**
- Turn on whatever persistence Phase 0 recommends, and retire the
  "this session only" badges (`isSessionOnly`, `isSessionOnlyDatabase`) that
  currently tell the truth about a memory-only build.
- Feature-parity pass against the finalized native UI from Stages 10–12.
- PWA installability: manifest, service worker, offline shell, install prompt.
- The web editor is **plain text and read-only for formatted notes**
  (`components/RichEditor.web.tsx`). Decide whether Stage 13 raises it, and if
  so onto what — the `@tiptap` chain the library ships for web is marked
  experimental and currently unresolvable in this tree.
- Reconcile "move New Note + search into the editor section" against wherever
  Stage 12 landed them — confirm, don't re-decide.

**Prompt — Phase 0 spike (REWRITTEN 2026-08-25; the pre-12g version is dead —
it told you to fix a boot failure that no longer exists and not to add a package
that is already installed):**

```
Create a branch `spike/powersync-web-at-rest` off main. This is an INVESTIGATION, not a feature. Do not build UI. Do not modify existing app code outside a throwaway spike directory. The deliverable is a written recommendation plus working proof, and a clear go/no-go.

CONTEXT — READ THIS BEFORE PLANNING, IT HAS CHANGED:

Native runs PowerSync on op-sqlite + SQLCipher (whole-file encryption at rest), with note title/body and folder names ADDITIONALLY encrypted client-side with AES-GCM via @noble/ciphers before they reach the server. That field layer is platform-independent and already runs on web unchanged.

Web works. Stage 12g (main @ a5ccd9f) put @powersync/web@2.1.0 in and the real app boots in a browser. It persists NOTHING on purpose: WASQLiteVFS.InMemoryVfs for the database, an in-memory Map for the vault keys. Read lib/powersync/openDatabase.web.ts and lib/crypto/secureStorage.web.ts first — the reasoning is written in them, and the two are deliberately coupled.

CORRECTION TO THE OLD BRIEF: @powersync/web DOES support whole-file encryption — it takes an `encryptionKey` and uses ChaCha20 via SQLite3MultipleCiphers. The earlier claim that there is no SQLCipher equivalent on web is false. Verify this yourself rather than taking it from me, then plan around what you find.

GOAL: decide what web is allowed to write to disk, and what the resulting user-facing guarantee is. The unsolved part is KEY CUSTODY, not cipher availability.

INVESTIGATE AND REPORT ON:

1. The persistent VFS choices @powersync/web offers (IDBBatchAtomicVFS, OPFSCoopSyncVFS, AccessHandlePoolVFS, OPFSWriteAheadVFS) — where each actually writes, durability, multi-tab behaviour, and which survive a browser clearing "site data". Say which one you would pick and why.

2. Confirm the encryptionKey path end to end on the VFS you picked: that the file on disk is genuinely unreadable without the key. Not "the API accepts it" — bytes.

3. KEY CUSTODY, the real question. No Keychain, no Keystore, no expo-secure-store. Evaluate: WebCrypto non-extractable CryptoKey in IndexedDB; WebAuthn PRF extension; passphrase-derived key held only in memory per session; and any combination. Judge each on (a) does the raw key ever sit recoverable on disk, (b) what does the user have to do per session, (c) what happens on a shared or stolen machine. The native app unlocks via OS biometric/passcode — say what the closest honest web equivalent is, and how far short it falls.

4. THE THREAT MODEL, stated concretely. Whatever you recommend: what is protected, and against whom? Be specific about the attacker who has the device versus the attacker who has script access to the origin — an XSS reads any key the page can read, which is the case native does not have. Name what sits in the clear locally even with the DB encrypted (ids, timestamps, trash state, folder structure, sync metadata, ui_state, note_sync_base).

5. Quantify the delta versus native, honestly. This is likely a downgrade; say by how much rather than glossing it. Include what happens to the "session only" story — if persistence lands, the current in-memory design and its badges go away, and that is a user-visible change to what the app promises.

6. PROVE IT. Build a minimal spike: @powersync/web on the persistent VFS you chose, write rows, close the tab, reopen, show the data comes back. Then open the browser's storage inspector and screenshot what is actually readable on disk — WITHOUT the encryption key and WITH it. That contrast is the deliverable's evidence.

7. PWA vs Trusted Web Activity for distribution, briefly. TWA is an Android packaging path around a PWA, so it is downstream, not an alternative architecture — say whether it is worth doing at all given the app already ships native Android.

DELIVERABLE: docs/web-at-rest-findings.md — findings, recommendation, the honest security delta versus native, and an explicit GO or NO-GO on proceeding to web UI work. If GO, write the resulting user-facing guarantee in plain language, since it has to be documented publicly the same way the native E2EE guarantee is. "Web cannot match native at rest, ship it session-only and lean on export/import" is a legitimate outcome, not a failure — the in-memory design already works and is honest.

Escalate before making any decision that changes the app's stated encryption guarantee, adds a dependency to the main app, or alters shared crypto code. Leave main untouched.
```

**📸 SCREENSHOTS:** none required — this stage ports Stages 10–12's screenshots, doesn't need new ones.

---

## Stage 14 — Website (marketing)

**Settled:** separate repo, built on **Frappe**, static HTML compiled into the `www` directory. **Single page**, no docs site — the repo's existing self-hosting docs stay where they are.

**Design inspiration (in place of screenshots for this stage):**
- Primary: minimal single-page sites in the style of [easlo.co/apps/experiments](https://www.easlo.co/apps/experiments) — spare, content-forward, generous whitespace.
- The `apple-design-system` skill, same as every other iteration-2 stage.

**Links** (footer or a dedicated links section — Claude Code's call):
- App Store — **disabled**, shows "Coming soon" on hover (not published there yet).
- GitHub — the app repo.
- Android — links straight to the **latest downloadable Expo EAS build**, not a Play Store listing (not published there either).
- Reach out — `mailto:adam.dawoodjee+notes@gmail.com`.

Fully independent of app internals; can run in parallel with any app stage on its own repo and session.

**📸 SCREENSHOTS** — none. Build from the design inspiration above instead of a static mock.

**Prompt:**

```
This runs in a NEW, SEPARATE repository, not the open-notes app repo. Create it, and tell me the name you're using before you start committing.

Build a single-page marketing site for open-notes on the Frappe framework, output as static HTML into the app's www directory. One page. No documentation site — the app repo already has self-hosting docs and a roadmap; link to them on GitHub rather than duplicating them here.

CONTEXT ON WHAT THE PRODUCT IS — get this right, it's the whole pitch:
open-notes is a local-first, cross-platform, end-to-end encrypted notes app. It works fully offline with no account; signing in is how you turn on SYNC, never a precondition for using the app. Note content, titles, and folder names are encrypted on-device — the server, including a self-hosted one, only ever holds ciphertext and cannot read them. It's open source and self-hostable. Notes belong to the person who wrote them: there's a per-note "Visible to Apps" toggle and an on-device broker that is the only path to decrypted content, so other apps and AI get access on the user's explicit terms rather than by default. On-device AI works within that model because the key is already local; anything server-side would require a separate, explicit, off-by-default opt-in. Don't overstate — the repo is at v0.1, mobile-only shipping today, with web on the roadmap.

DESIGN INSPIRATION: primary reference is minimal single-page sites in the style of https://www.easlo.co/apps/experiments — spare, content-forward, generous whitespace. Read the apple-design-system skill and follow it too: clean, minimal, confident typography, generous whitespace, restrained motion. Dark mode. No stock-photo filler, no fake testimonials, no invented metrics or user counts.

Sections, in this order: a hero with the one-sentence pitch and a GitHub link; what makes it different (local-first, E2EE including folder names, no account required, open source and self-hostable); the ownership/AI-boundary principle stated plainly since it's the point of the project; honest platform status (iOS and Android today, web on the roadmap); and a links section with exactly these four: App Store (DISABLED, "Coming soon" on hover — not published yet), GitHub (the app repo), Android (link directly to the latest downloadable Expo EAS build artifact, not a Play Store listing — not published there either), and a "reach out" mailto link to adam.dawoodjee+notes@gmail.com.

Before writing copy, ask me for: the repo name to use, the domain if one exists, the current Expo EAS build link to point the Android link at, and confirmation of anything above you're unsure is still accurate — the app is at v0.1 and I'd rather you check than publish a claim that's drifted.

Deliver the static build in www/, confirm it renders correctly at mobile, tablet, and desktop widths, and screenshot all three.
```

---

## Stage 15 — Export / Import (`.zip`)

**Settled decisions:**
- **Entry point:** new main-menu item -> **Settings > Data**, with its own **Import** and **Export** sub-pages, each carrying a concise explainer of what the operation does.
- **Export creates folders** — nested directories mirroring the folder hierarchy, packaged into a single **`.zip`**. Internal structure unchanged from the original plan; only the delivery format changed (see Decisions Log).
- **Export scope** is a segmented selector styled like the existing `Security > Lock Timer` control: **`Everything`** (including trashed) or **`Choose`**, where selecting `Choose` enables a folder selector defaulting to `All Notes`.
- **Import source is now a `.zip` file**, picked via the OS file/document picker — **supersedes the earlier directory-picker plan** (see Decisions Log). Sidesteps the uneven mobile directory-picker support that was flagged as an open risk, since plain file picking is well-supported everywhere.
- **Import creates folders** that don't exist yet, with **Include in Notes ON by default** so imported content shows up in All Notes without extra steps.
- **Import Folder placement** — a new segmented toggle, same family as the Export scope selector, **defaulting to `All Notes`**: **`All Notes`** (imported hierarchy attaches at the top level — the default; imports don't land in an "Imported" folder unless the user explicitly chooses that) or **`Imported`** (everything nests under one persistent top-level "Imported" folder, created once and reused by every later import — never a new one per run).
- **Eliminate pass-through wrapper folders** — a folder in the zip with no notes of its own (only subfolders) isn't created as an app folder; its children attach to its parent instead.
- Collision rules unchanged: **duplicate** when body content differs, **skip** when identical, **overwrite** only when an explicit overwrite toggle is on.
- **Both operations run in the background and must be failure-tolerant** — a bad entry inside the zip is skipped and reported, never a reason to abort the whole run.

Parsing/format logic has no UI dependency and could start early; the scope selector and the Import Folder toggle need Stage 10's folder model.

**📸 SCREENSHOTS** — none for this stage. Build the Settings > Data entry point and both sub-pages against existing Settings-page patterns, and match both segmented controls (Export scope, Import Folder placement) to the existing Security > Lock Timer control.

**Prompt:**

```
Create a branch `stage-15-export-import` off main; merge back once the checkpoint passes.

CONTEXT: Stage 10 (Folders) is merged — export and import both operate on that hierarchy. Note bodies are HTML (corrected 2026-08-21 — this prompt previously said "Tiptap JSON, not markdown and not HTML", which was simply wrong; see types/note.ts:106, which documents TenTap seeding `<h1></h1>`. Stage 11.5 keeps them HTML, so export still has to CONVERT html -> markdown, exactly as planned below); note titles, bodies, and folder names are all encrypted at rest and in transit, so everything here works on DECRYPTED LOCAL DATA ONLY. There must be no path where export or import round-trips content through the server. Zipping/unzipping needs a library the app doesn't currently depend on — that's a NEW DEPENDENCY under the standing project rule, so propose one and stop for approval in Plan Mode rather than picking one silently.

=== ENTRY POINT ===
New main-menu item -> Settings > Data, with its own Import and Export sub-pages. Each sub-page carries a short, concise explainer of what the operation does (e.g. Export: "Makes a .zip of your notes as Markdown files"; Import: "Reads notes back in from a .zip") before the user commits to running it. Match the existing Settings sub-page shell rather than inventing a new one.

=== EXPORT ===

Internal format: Markdown (.md), nested into directories that mirror the folder hierarchy — a note in Work/Projects/Q3 exports to Work/Projects/Q3/<note>.md. Nothing else in this stage; HTML and raw-file export are iteration 3.

DELIVERY FORMAT: the whole export is packaged into a single `.zip`, on EVERY platform. This replaces the original plan of handing over a bare directory tree (see Decisions Log) — a zip is one file, so "where does the export land" collapses to a single share-sheet/document-picker round trip everywhere, instead of needing separate iOS/Android handling.

Scope selector, unchanged from the original spec — a segmented control styled like the existing Security > Lock Timer selector (find it and match it, don't invent a new control pattern):
  - "Everything" — every note INCLUDING trashed ones
  - "Choose" — enables a folder selector, defaulting to All Notes
State how trashed notes are represented under "Everything" (a Recently Deleted directory inside the zip is the obvious answer) and confirm restoring them isn't implied by exporting them.

The real work here is still TIPTAP JSON -> MARKDOWN conversion, unaffected by the zip wrapper. Before implementing, report what node types the editor actually produces in this app (inspect real note bodies, don't assume the full Tiptap feature set), which map cleanly to Markdown, and which don't. For anything that doesn't map, propose a fallback and flag it — silent data loss on export is the worst possible outcome for a feature whose entire purpose is "your notes are yours." Prefer a check-in over a guess here.

Filenames: derive from note titles, which are arbitrary user text — handle empty titles, duplicate titles within one folder, path-illegal characters, and length limits. Say what you chose.

RUNS IN THE BACKGROUND: zipping a whole notes archive can take a while — show progress, let the user navigate away, don't block the UI thread. FAILURE-TOLERANT: if one note fails to convert or one folder can't be read, skip it, keep going, and report it in the final summary rather than aborting the whole export.

=== IMPORT ===

IMPORT SOURCE IS A `.zip` FILE, picked via the OS file/document picker. This SUPERSEDES the earlier directory-picker plan (see Decisions Log) — directory picking was unevenly supported across iOS and Android, and a zip sidesteps that entirely since plain file picking is well-supported everywhere.

IMPORT FOLDER PLACEMENT — a new segmented toggle, same styling family as the Export scope selector, DEFAULTING TO "All Notes":
  - "All Notes" (default) — the imported hierarchy attaches at the TOP LEVEL, alongside existing folders. Imports never land inside an "Imported" folder unless the user explicitly picks that option.
  - "Imported" — everything nests under ONE persistent top-level "Imported" folder. Created once; every later import reuses the SAME folder rather than creating "Imported 2", "Imported 3", etc. This is decided — implement exactly this, don't relitigate it.

Folders created during import default Include-in-Notes to ON, so imported content is visible in All Notes without the user having to go toggle it — this follows Stage 10's existing per-folder default, called out explicitly here since machine-created folders during import are an easy place to get it wrong. VERIFIED against the actual Stage 10 code (not an assumption): Include-in-Notes is evaluated per-folder from a note's own immediate folder, NOT inherited from ancestors — see components/NotesLayout.tsx's `excludedFolderIds`/`allNotesCount` (`n.folderId === null || !excludedFolderIds.has(n.folderId)`, checking only the note's own folder) and scripts/verify-folders-local.ts's equivalent SQL. This is what makes notes in a subfolder show up correctly in All Notes even when an ancestor "Imported" wrapper folder isn't itself surfaced there.

ELIMINATE PASS-THROUGH WRAPPER FOLDERS: if a folder inside the zip contains no notes of its own — only subfolders — don't create an app folder for it; attach its children directly to its parent instead. This matters because zip tools commonly wrap an export in one extra top-level directory (zipping a folder named "MyExport" often produces a zip whose only top-level entry is "MyExport/"), and combined with the "Imported" wrapper option that can otherwise stack two or three levels of meaningless empty folders before the user's real structure starts. Apply this collapsing recursively. Keep Stage 10's 5-level depth cap in mind — collapsing artifact folders should mean the cap gets hit LESS often, not more.

COLLISION RULES, decided — implement exactly these:
  - Same title, DIFFERENT body content -> create a duplicate, keep both.
  - Same title, IDENTICAL body content -> skip silently.
  - Overwrite ONLY when an explicit overwrite toggle is enabled by the user.
Content comparison has to happen on decrypted plaintext, and "identical" needs a defined normalization (trailing whitespace, line endings) — state what you used, because getting this wrong turns skip into duplicate on every import.

Markdown -> Tiptap JSON on the way in. Anything unrepresentable should degrade to plain text rather than being dropped.

RUNS IN THE BACKGROUND, same as export, and FAILURE-TOLERANT: a corrupt zip entry, an unreadable file, or a note that fails to parse should be skipped and reported, not abort the whole import.

Report the result of an import to the user: counts of created, duplicated, skipped, overwritten, AND errored. A silent import on someone's whole notes archive is unnerving.

=== VERIFY ===
- Round-trip: export a hierarchy several levels deep containing notes with headings, lists, checklists, bold/italic, and links; wipe local state; re-import (test both "All Notes" and "Imported" placement); confirm structure and content survive. Report anything that didn't, honestly.
- Re-import the SAME zip twice and confirm the second run skips everything rather than duplicating it.
- Modify one note's body, re-import, confirm exactly that one duplicates and nothing else does.
- Import with the overwrite toggle on and confirm it overwrites rather than duplicating.
- Export with "Everything" and confirm trashed notes are included and clearly separated.
- Zip a folder that produces a single empty top-level wrapper directory (the common zip-tool artifact) and confirm it's collapsed away rather than appearing as an extra empty folder in the app.
- Run a second import with "Imported" selected and confirm it reuses the same Imported folder rather than creating a second one.
- Interrupt an export and an import partway through (background the app, kill it, whatever's realistic) and confirm the failure is reported cleanly rather than corrupting existing data.
- Confirm no network request occurs during either operation — prove it, don't assert it.
- tsc --noEmit and lint clean.
```

---

## Stage 16 — Env file / sign-up toggle

**Settled:** enforcement is **Supabase-side**, not merely a hidden client control — a client-only toggle is trivially bypassable against a live project.

Independent, small, no screenshots — good to run alongside Stage 9.

**Prompt:**

```
Create a branch `stage-16-signup-toggle` off main; merge back once it's verified.

Add the ability for an operator (self-hoster or me) to disable new sign-ups while leaving existing accounts fully working.

ENFORCEMENT IS SUPABASE-SIDE. Hiding the sign-up path in the client only is trivially bypassable — anyone can hit the auth endpoint directly against a live project. Find how Supabase actually disables sign-ups (there's a GoTrue/auth setting for this; verify the current mechanism rather than trusting memory or an old blog post), and document it for both cases: the self-hosted docker-compose stack, and a hosted Supabase project where it's a dashboard/config setting rather than a repo file.

The client should ALSO reflect the state, so a user isn't shown a sign-up path that will just fail — but treat that as UX, not as the enforcement. Decide how the client learns the setting: an EXPO_PUBLIC_ variable mirroring the server config is the simple option, but it can drift from the server's actual state. Say what you chose and what happens if the two disagree — the failure has to be graceful and honest ("sign-ups are currently closed"), never a generic auth error.

Add the variable to .env.example with a one-line comment matching that file's existing convention, and update the self-hosting docs where they cover auth configuration. Keep it brief; this is a small feature and the docs shouldn't imply otherwise.

Confirm existing users can still sign in when sign-ups are disabled — that's the whole point, and it's the thing most likely to break.

VERIFY: against the local dev stack, disable sign-ups and prove (a) a new sign-up attempt is refused SERVER-SIDE, shown by hitting the endpoint directly, not just by the button being hidden, and (b) an existing test account can still sign in. Then re-enable and confirm both reverse. Report actual output.
```

---

## Deferred to the end of iteration 2

Parked deliberately, with a landing point, so they don't evaporate into "we'll get to it".

- ~~**Force-swipe-to-commit on note rows.**~~ **No longer deferred — shipped in Stage 11.**
  It was going to be deferred because `ReanimatedSwipeable` cannot do it; that migration
  was reverted (see the Decisions Log), and the hand-rolled implementation it went back
  to already had it. All four swipe refinements are in.

---

## Open Questions — remaining

One blocking item; the rest is settled and recorded in the Decisions Log below.

1. **Stage 12 screenshots** — nearly resolved (rescanned 2026-08-21): only the mobile scrolling-bar *collapsed* state is still missing, and the prompt's Apple Notes fallback covers that one gap.
2. ✅ **RESOLVED — directory picking on mobile:** the risk called out here (uneven iOS/Android support for directory selection) is why Stage 15's import source changed from a directory picker to a `.zip` file picker — see the 2026-08-21 Decisions Log entry below. Plain file picking doesn't have this problem, so the escalation this item predicted won't come back.

---

## Decisions Log

*(iteration-2-specific decisions, same terse format as `dev-docs/mvp-build-plan.md` — decision / reasoning / verification / status. Don't duplicate MVP-era entries.)*

### 2026-08-27 — The gate KDF is scrypt N=2^13, chosen on measurement
- **Decision:** `GATE_KDF_PARAMS` = scrypt N=2^13, r=8 — **434 ms** per attempt, ~5 days for a browser-confined sweep of all 10^6 PINs. Down from N=2^16, which was written on an estimate and actually costs **3,123 ms**.
- **Reasoning:** Pure-JS scrypt normally loses badly to a native attacker, and native WebCrypto PBKDF2 at 1M iterations costs only 126 ms here — a 44x better rate. That argument does **not** apply, for one specific reason: guessing requires `browserSecret`, which is sealed under a non-extractable WebCrypto key, so its bytes cannot leave the browser. Any sweep has to run in the victim's own browser, in JavaScript, at our speed. Defender/attacker is ~1:1 either way, so the only question is cost per unlock, and scrypt's memory hardness comes free.
- **Consequence accepted:** ~430 ms on every web unlock, about a Face ID prompt. Raising it later costs existing users nothing because the parameters travel with each stored blob — which was proven by accident when the retune landed and an already-enrolled PIN kept working at its old cost.
- **Status:** done. `npx tsx scripts/bench-gate-kdf.ts` reproduces the table. **Do not measure this in the automated browser** — it reports `visibilityState: hidden`, which clamps setTimeout to 1s and pauses rAF, so every reading pinned near 6000 ms regardless of parameters and a second retune was nearly made on that garbage.

### 2026-08-25 (later) — Web gets a real lock: biometric, or a 6-digit PIN
- **Decision:** Reverses the "no lock screen" call above, made hours earlier. Adam: *"on mobile and macos, the web app should use the usual biometric lock, if these are unavailable without locking the whole computer, a 6 digit pin can secure the app."* Locking **wipes the keys from memory**; unlocking re-derives them. Lock settings **inherit from native, and all settings sync across devices**.
- **Reasoning:** The earlier call rested on "without WebAuthn PRF there is nothing real behind a web lock screen". That premise was too pessimistic — PRF *is* available on the platforms Adam named (Touch ID on macOS, Face ID on iOS Safari 18+, Android), and where it is not, a PIN combined with the non-extractable browser key is a genuine gate rather than a decorative one. Adam's position is that the web app should not be the weak platform.
- **Consequence accepted:** Web's lock is now **stronger than native's**, which is a deliberate asymmetry rather than an oversight — native keeps keys resident while locked so sync continues in a pocket (`lib/crypto/vault.ts:160-168`); web discards them, so a locked tab holds nothing. It also means a locked web tab stops syncing until unlocked. The PIN adds a credential the app did not have, and Stage 6.5 removed one for good reason — so the PIN is **never** the sole protection: the non-extractable KEK is a required input, which is what stops an attacker with the files from attempting even one guess. The 12-word recovery code remains the independent path if the PIN is forgotten or the authenticator is lost.
- **Status:** planned across 13a/13b/13c. **The biometric path cannot be verified here** — no platform authenticator is available to this browser, so PRF needs Adam's hands on a Mac and a phone. The PIN path is fully testable.

### 2026-08-25 (later) — Settings sync, and the boot circularity it creates
- **Decision:** A new synced `user_settings` table (owner-only RLS) becomes the source of truth for lock settings (13b) and then appearance/theme/bullet style (13c). `secureStorage` keeps a **local mirror** that boot reads.
- **Reasoning:** Adam asked for settings to sync. A synced setting alone cannot work for the lock: reading PowerSync needs the database, which needs the key, which needs the unlock, which needs the lock setting — circular. The mirror breaks it, and it is not a new invention: `vault.ts:292` already mirrors lock settings into the vault blob for exactly this reason ("readable before the database is open").
- **Consequence accepted:** Two copies of every setting, so a sync conflict or a stale mirror is now possible where it was not before; the mirror is authoritative at boot and the table wins afterwards. Also a **schema change** — new migration file, applied locally then `supabase db push`, never an edit to an applied migration.
- **Status:** planned; 13b carries lock settings, 13c the rest.

### 2026-08-25 — Web ships encrypted (the lock half of this was REVERSED same day — see below)
- **Decision:** Adam cleared all three remaining Phase 0 gates. (a) Encryption at rest on web is **mandatory** — a missing key is a hard failure at open time, mirroring native's `getDatabaseKey()` discipline. (b) The ~+0.2 MB net WASM cost is **approved**. (c) The web build gets **no lock screen**. Adam: *"Security is mandatory, the user will be expected to keep their computer locked. Not our problem if their security is lax."* Final public wording is in `dev-docs/web-at-rest-findings.md`.
- **Reasoning:** Without WebAuthn PRF there is nothing real behind a web lock screen — it would be a dialog that implies a protection the browser cannot provide, which is worse than its absence. The OS lock is the honest boundary, and the user is the right party to own it. Encryption stays mandatory regardless, because it defends the case the user cannot control: files copied off the machine.
- **Consequence accepted:** On the web, an attacker sitting at an unlocked machine gets the notes — there is no second gate. That is a real difference from the phone app and the public wording states it in those words rather than hedging. It also means `LockSettings` and the `locked` vault state stay native-only, and the web build reports the lock as *unavailable* rather than *off*.
- **Status:** the encryption and bundle-size halves stand. **The "no lock screen" half was reversed the same day** — see the next entry. The public wording below is therefore also superseded; it described a build with no lock.

### 2026-08-25 — `OPFSCoopSyncVFS`, not the IndexedDB default
- **Decision:** When web persistence lands, use `WASQLiteVFS.OPFSCoopSyncVFS`.
- **Reasoning:** `vfs.js` routes only `IDBBatchAtomicVFS` through the async module factory, so with encryption on it needs `mc-wa-sqlite-async.wasm` (2.50 MB) where OPFS needs `mc-wa-sqlite.wasm` (1.31 MB). OPFSCoopSync is *also* the SDK's own multi-tab/Safari recommendation, so the cheaper option is the better one — the two criteria point the same way, which is rare enough to just take.
- **Consequence accepted:** OPFS rather than IndexedDB means slightly narrower browser support than the SDK default, and the `.ahp-*` access-handle pools are visible in origin storage. Both were exercised on this machine. The prune in `package.json`'s `powersync:assets` has to stop deleting `mc-*`, and the larger `.wasm` gets committed.
- **Status:** decided, not yet implemented — Phase 1 owns it. A file-placement/config call rather than an escalated one; logged because it changes what gets committed to the repo.

### 2026-08-23 — Drag-to-reorder is hand-built, not a dependency
- **Decision:** Adam chose option 1 of three. Build folder drag-to-reorder directly on `react-native-gesture-handler` + Reanimated 4 (`components/ReorderableFolderList.tsx` + `lib/notes/reorder.ts`), and drop `react-native-reanimated-dnd` entirely.
- **Reasoning:** Neither published version of the library works here. `1.1.0` declares `react-native-reanimated >= 3.0.0` but calls `useAnimatedGestureHandler`, removed in Reanimated 4 — so it installs, type-checks and builds, then throws at first render. `2.0.0` needs Reanimated >= 4.2.0; Expo SDK 54 pins `~4.1.1`. Bumping the animation library that the motion primitives, the icon button, the format bar and the vendored swipeable all sit on, in order to satisfy folder reordering, is the wrong way round.
- **Consequence accepted:** ~230 lines of gesture and animation code the project now owns and maintains. Bounded by what this list is NOT — one level, under a dozen rows, uniform height, edit mode only — so there is no nesting, virtualisation, cross-list drag or auto-scroll to get right. If a second sortable list ever appears, this is the thing to generalise rather than a library to re-evaluate.
- **Status:** done. 167/167 tests; drag proved end to end in a browser (exact landing slot, both clamps, drop-in-place); edit-mode layout screenshotted on iPhone 17 Pro. **Not proved:** the pan winning against iOS's scroll view on a real finger — untestable here, defended twice.

### 2026-08-23 — A dropped folder renumbers the level; an arrow still swaps
- **Decision:** `moveTopLevelFolderToIndex` writes a contiguous `sort_order` across every top-level folder in one transaction. `moveTopLevelFolder` (the arrows, and now the VoiceOver actions) keeps its two-row swap.
- **Reasoning:** A drop lands on an arbitrary slot. Dragging the first folder to the fourth is a rotation, not a swap, and expressing it as a chain of swaps would write the same rows anyway while passing through orders the user never saw.
- **Consequence accepted:** Two devices dragging concurrently resolve last-writer-wins over the whole level rather than merging, which the swap path avoids. At one user, one level, under a dozen folders, a clobbered reorder costs one more drag; an order nobody chose costs trust in the control. The renumber also repairs the equal-`sort_order` case the swap path has to special-case.
- **Status:** done.

### 2026-08-23 — The drag handle replaces the arrows; VoiceOver keeps them
- **Decision:** In edit mode a grip handle takes the place of the up/down arrow pair, and `onMove` is republished as VoiceOver `moveUp`/`moveDown` actions on the row. Children of an expanded folder are not rendered while editing.
- **Reasoning:** Three controls do not fit a 250pt iPad sidebar column, and iOS puts a grip there rather than arrows. A drag handle is unusable to a screen reader, so the arrows had to survive as *something*. Hiding children is load-bearing rather than cosmetic: the drag maths assumes uniform row height and an expanded parent is as tall as its subtree.
- **Consequence accepted:** Sighted users lose the tap-to-nudge affordance, and the tree flattens while editing. Both are one conditional to reverse if the flattening reads as data loss rather than as a mode.
- **Status:** done; verified on iPhone 17 Pro (grips present on the three reorderable rows, absent on Skills and both virtual rows, and the expandable folder's chevron correctly gone).

### 2026-08-23 — The bottom sheet gets a platform seam
- **Decision:** `components/ModalSheet.tsx` re-exports the native sheet; `ModalSheet.web.tsx` is a plain positioned panel with a click-to-dismiss scrim and the same prop shape.
- **Reasoning:** `@swmansion/react-native-bottom-sheet` is a Fabric component with no web implementation. Swapping both sheets onto it in items 3 and 4 took web from working (12g) straight back to a red error screen — `codegenNativeComponent is not a function` — and because the throw is at *import*, no guard at the call site could have caught it. Only Metro's platform resolution keeps it out of the web bundle.
- **Consequence accepted:** Web loses drag-to-dismiss and the detent physics, which are the native sheet's whole point. Re-implementing them in JS would be a second, worse sheet to maintain, and on a desktop browser there is no thumb to drag with — the scrim and the sheet's own close button are the real dismissal routes there.
- **Status:** done; web boots again and both sheets present correctly.

### 2026-08-22 — Planning docs live in `dev-docs/`, tracked in git
- **Decision:** Move `prd.md`, `mvp-build-plan.md`, `iteration-2-build-plan.md` and the design screenshots into `dev-docs/`, and remove them from `.gitignore`. `docs/` stays the user-facing set.
- **Reasoning:** Adam asked to be more deliberate about planning documentation. A plan outside the repo is not inspectable, cannot be reviewed in a diff, and does not travel with the branch it describes — and this project already paid for that once, when stage state existed only in commit messages.
- **Consequence accepted:** The plans are public if the repo is. They contain no credentials; the scrub found only email addresses, two of them a deliberately-public contact. The commit history carries the author's address regardless, so committing the docs changes nothing about that.
- **Status:** done; every code and doc reference repointed.

### 2026-08-22 — The mobile format bar is tied to the keyboard, not to the editor
- **Decision:** Show the keyboard-docked formatting bar only while the software keyboard is up or text is selected. Supersedes the 12d decision to keep it on screen with a safe-area inset when the keyboard is down.
- **Reasoning:** Adam's call. The original reasoning — it is a phone's only formatting affordance — was true and led to the wrong place: a bar permanently occupying the bottom of the screen during reading, which is most of what a note is for. Dismissing the keyboard is the existing gesture for "done editing".
- **Consequence accepted:** Formatting a note now requires the caret to be in it. That is the same rule iOS applies to its own format selector. The selection condition covers the hardware-keyboard and long-press cases where the software keyboard is absent but formatting is clearly wanted.
- **Status:** built and verified on iPhone 17 Pro across the full appear/follow/leave cycle.

### 2026-08-22 — Web is session-only: memory database, memory keys
- **Decision:** Add `@powersync/web`, pinned to 2.1.0, configured with `InMemoryVfs`; store the vault's device key and wrapped vault in an in-memory Map on web (`lib/crypto/secureStorage.web.ts`). Nothing on web persists across a page load.
- **Reasoning:** Web had no way through the boot failure screen at all, and Adam asked for one now rather than at Stage 13. Persisting on web forces the at-rest question immediately — no SQLCipher in a browser, and every place to put a key is readable by any script on the origin. Memory-only sidesteps it rather than pre-empting Stage 13's Phase 0 spike: there is nothing at rest and no key to store. 2.1.0 rather than 2.2.0 because 2.1.0's peer range is satisfied by the `@powersync/common@2.0.0` the native SDK already pins; 2.2.0 would drag the shared core up under native's feet for a web-only feature.
- **Consequence accepted:** A refresh is a new session with an empty database and new keys. Export-then-reimport is what makes that survivable and it does not exist yet — it lands in **Stage 13**. Until then a web session's notes cannot leave the tab. 1.6 MB of pre-bundled worker assets are committed under `public/@powersync/` (three of four wasm builds deleted; see the README there).
- **Status:** built and verified in the browser — note created, typed, saved encrypted, listed. Native re-verified unchanged on iPhone 17 Pro.

### 2026-08-22 — The web editor is plain text, and refuses formatted notes
- **Decision:** `RichEditor.web.tsx` becomes a real plain-text editor rather than a read-only view, but only for notes that are already nothing but a heading and paragraphs (`isPlainTextSafe`). Anything richer stays read-only with the reason stated.
- **Reasoning:** Read-only is a dead end one screen further in — Adam's requirement is to "create and export notes". But the editor autosaves, so opening a bold-and-bullets note on web and touching nothing would have written the flattened projection back. That is data loss caused by looking at a note.
- **Consequence accepted:** Notes written on the phone with any formatting cannot be edited on web at all until Stage 13 gives web a real editor. The first line becomes an `<h1>`, matching the native seed, so the same note does not look different on two devices.
- **Status:** built; the projection's round trip, escaping and refusal are under test (7 new tests, 119 total).

### 2026-08-22 — Sync controls and account setup are not centralised yet
- **Decision:** Storage and recovery go into Manage Account now, as a "Storage on this device" group. No Settings › Sync section is invented for it.
- **Reasoning:** Adam, 2026-08-22: "the manage account. we later need to think about and centralize sync controls and account setup". Inventing the structure now would pre-empt exactly the thinking that decision defers.
- **Consequence accepted:** **Recorded with no landing stage, at Adam's explicit instruction** ("Just note it in the Decisions Log"). Flagged at the time and repeated here: a deferral without a landing stage is the half that goes missing and resurfaces as rework. Sync controls are currently spread across Manage Account, the enable-sync route, and Settings, and nothing yet forces them together.
- **Status:** deferred, unscheduled.

### 2026-08-22 — One folder-sidebar header at every width; Edit trails the title
- **Decision:** Drop the wide-layout header variant (`Edit` far left, small centred title) and use the phone's arrangement everywhere: large left "Folders" title, `Edit` then the overflow trailing it on the same row. Adam's call, after seeing it on an iPad.
- **Reasoning:** Apple Notes' own iPad header (`folders/ipad/ipad-landscape-folder-view.jpeg`) puts Edit on the far left, but it has **no title at all**. Copying its Edit placement while also keeping a title produced a third arrangement that was neither reference — and it meant the same control moved to the opposite side of the screen depending on how the device was being held. This supersedes the placement recorded in the 2026-08-21 Skills-reordering entry below.
- **Consequence accepted:** A deliberate divergence from the iPad reference screenshot, which is otherwise treated as authoritative. The wide sidebar is ~250pt, so a `text-3xl` title now shares that row with two controls; measured on device it fits with room, and the title already truncates rather than clipping at large Dynamic Type.
- **Status:** built and verified on iPad Pro 13 in landscape and re-checked on iPhone 17 Pro.

### 2026-08-22 — Full swipe lives inside the vendored component, not on top of it
- **Decision:** Implement full-swipe-to-commit in `components/vendor/ReanimatedSwipeable/ReanimatedSwipeable.tsx`, inside `handleRelease`, as three new props in the library's own style (`fullSwipeLeftThreshold`, `fullSwipeRightThreshold`, `onFullSwipe`) — not in our wrapper on the public `progress` value, which is what the plan said.
- **Reasoning:** The public route has to decide AT RELEASE whether the drag peaked past the threshold, and the only public release signal is `onSwipeableWillOpen`, which is `runOnJS`'d. It lands on the JS thread frames after the spring has begun unwinding the overshoot the armed flag was read from. Whether the flag survives that gap is a race, and losing it silently fires nothing — the same failure mode as the dead-code commit threshold, which is the specific bug this stage exists to stop repeating. `handleRelease` already computes the release distance.
- **Consequence accepted:** The vendored file has a real behavioural modification, not just the upstream fix, so it is no longer a pure diff against 2.28.0. Mitigated by marking every change `// VENDORED:` and documenting all three in `components/vendor/ReanimatedSwipeable/README.md`. When RN reaches 0.82 and RNGH 3.x can be imported, full swipe is the one piece that still has to be re-homed — upstream discussion #2520 is still open, so it will not arrive for free.
- **Status:** built and verified. Full swipe fires in both directions on Android via real `adb shell input swipe` gestures; a medium swipe reveals without committing, proving the two stages are distinct.

### 2026-08-22 — `overshootFriction` is 1.18, not the docs' recommended 8
- **Decision:** Set `overshootFriction` from `OVERSHOOT_RATE` (0.85) rather than the value the library's own docs suggest.
- **Reasoning:** The docs recommend "8 or above" for a native feel, but that is tuned for a small rubber-band at the end of an opening gesture. Full swipe has to cross most of the row: at 8 the row would move about 19pt while the thumb moved 150, which is indistinguishable from the "budges and stops" complaint that a broken swipe produced earlier in this stage. One constant, `OVERSHOOT_RATE`, feeds both the friction and the armed-colour threshold, so they cannot drift apart — there is a test asserting exactly that.
- **Consequence accepted:** Overshoot is looser than the library intends, so the row can be dragged noticeably past its open position. That is the intended affordance here, and the commit threshold is what stops it being accidental.
- **Status:** built.

### 2026-08-21 — Folder names are encrypted, treated identically to note titles
- **Decision:** Folder names get the same client-side AES-GCM treatment as `title`/`body`. Structural columns (`id`, `parent_id`, `user_id`, ordering, timestamps, default-folder type flag) stay plaintext, matching the existing note-row split.
- **Reasoning:** A folder name leaks as much as a note title — "Therapy", "Tax 2026", "Job applications" — so plaintext folder names would contradict the core guarantee while note bodies beside them are ciphertext. Consistency also means no new crypto path: same envelope (`enc:v1:`), same key, same backfill discipline.
- **Consequence accepted:** No server-side filtering, sorting, or search on folder name — all local, post-decrypt, the same constraint note titles already live under. Default folders need a stable plaintext type flag rather than name-matching, since names aren't server-readable and may be localized later.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — One folder per note; top-level reordering only
- **Decision:** A note belongs to exactly one folder (single nullable reference on the note, no join table). Users can reorder top-level folders; re-parenting folders by drag and dragging notes into folders are both out of scope for iteration 2.
- **Reasoning:** Matches Apple Notes' model, which the whole UI is being designed against. Keeps the sync surface and conflict semantics simple. Drag-to-reparent and drag-notes-to-folder are additive later, not architectural.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — Recently Deleted is the trash restore/purge UI, auto-clearing after 30 days
- **Decision:** The Recently Deleted default folder becomes the surface for restore and empty-trash, wired to the existing `restoreNoteInDB` / `emptyTrashInDB` functions. Notes auto-purge 30 days after being trashed.
- **Reasoning:** Closes a known MVP gap (the DB functions existed but nothing in the UI called them, making trash effectively permanent) without a separate fix — the folder work needs a Recently Deleted surface anyway, so building it twice would be waste.
- **Consequence accepted:** Purge is client-driven, since an E2EE server can't evaluate note content — though `trashed_at` is plaintext and readable. A device that hasn't opened in months won't have swept; behavior in that case to be confirmed in Stage 10.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — "Include in Notes" excludes from All Notes only, not search
- **Decision:** Toggling a folder out of All Notes hides its notes from that list, but they still appear in search results.
- **Reasoning:** The toggle is about list clutter, not concealment. A note the user can't find by searching for it is a lost note; the Skills folder in particular holds real content the user may need to reach.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — Pin state syncs across devices
- **Decision:** Pinned is a synced column on the note, plaintext (a structural flag, like `is_trashed`, not user content).
- **Reasoning:** A pin is an organizational statement about the note, not a per-device view preference; having a note pinned on the phone but not the iPad would read as a sync bug.
- **Status:** Decided, lands in Stage 11.

### 2026-08-21 — Web ships as an installable offline PWA; at-rest story spiked first
- **Decision:** Web is a real target for iteration 2 — installable, offline-capable, full parity — with technology chosen on performance, simplicity, and fit with the existing stack. A Phase 0 spike answers the at-rest encryption question and returns an explicit go/no-go before any UI work.
- **Reasoning:** `@powersync/web` uses wa-sqlite/WASM with no SQLCipher equivalent, so the native whole-file encryption guarantee cannot simply be ported. The client-side AES-GCM field encryption does port unchanged; whether that alone is an acceptable guarantee is a product decision, not an implementation detail, and it must be answered before UI time is spent.
- **Status:** Spike prompt written, ready to run. Outcome pending.

### 2026-08-21 — Sign-up disable is enforced Supabase-side
- **Decision:** The sign-up toggle is enforced at the auth server, with the client reflecting the state as UX only.
- **Reasoning:** A client-side-only toggle is trivially bypassable against a live project — anyone can call the auth endpoint directly — so it would be a false guarantee for self-hosters running a private instance.
- **Status:** Decided, lands in Stage 16.

### 2026-08-21 — All Notes and Recently Deleted are virtual; Skills is the only real default row
- **Decision:** All Notes and Recently Deleted render as views, not folder rows. Recently Deleted is expressed over the existing `is_trashed`/`trashed_at` columns. Skills is seeded as a real folder row.
- **Reasoning:** Trash state already exists and is already synced; a Recently Deleted folder row would duplicate it and create two sources of truth, with the usual consequence that they drift. All Notes is a filter, not a container.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — Per-folder Group By Date and folder sort order are synced
- **Decision:** Both are synced columns on the folder, plaintext (structural, not content).
- **Reasoning:** These are statements about how the user organizes their notes, not per-device view preferences. A folder grouped by date on the iPad reading as ungrouped on the phone would look like a sync bug.
- **Consequence accepted:** Slightly more synced surface, and both become fields that can conflict — covered by the existing last-write-wins-per-field behavior.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — Parent folder note counts exclude descendants
- **Decision:** A folder's count is its own notes only, matching Apple Notes. Not an aggregate over subfolders.
- **Reasoning:** Matches the reference design the whole UI is being built against.
- **Open detail:** Apple may show an aggregate when a parent is collapsed; Stage 10's prompt instructs Claude Code to match the sidebar screenshots on that point and report what it found.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 — Notes in the Skills folder default to "Visible to Apps" on
- **Decision:** Notes created in or moved into Skills default `api_visible` to on, against the app-wide default of off. Wired through the existing per-note flag and the `lib/plaintext/` broker — no parallel mechanism, no broker bypass. The per-note toggle still works normally inside Skills, and moving a note out doesn't silently flip its visibility.
- **Reasoning:** Skills exist to be read by the app and connected apps; a skill no app can read is inert. The folder carries the user's intent, so the default follows it.
- **Consequence accepted:** This is the first place in the app where a security-relevant default is *on*. It is scoped to one folder the user has to deliberately put content into, and every disclosure still passes through the broker's consent and audit path — but it's a real widening of the default, and Stage 10's prompt requires the resulting behavior on every path to be stated explicitly in the summary.
- **Status:** Decided, lands in Stage 10.

### 2026-08-21 (review 2) — Skills is pinned; New Folder moves into an overflow menu
- **Decision:** The Skills folder cannot be reordered — it sits directly under All Notes, with user folders reordering among themselves below it. The sidebar header becomes `Edit` (left) · `(...)` (right), with New Folder inside the overflow alongside an Enable/Disable Skills Folder toggle. **Superseded 2026-08-22** — see the header entry above; Edit now trails the title at every width.
- **Reasoning:** Skills is a fixture of the app rather than one of the user's folders, so letting it drift through the list made it look like an ordinary one. Guarded in `moveTopLevelFolder()` as well as the UI, so a later caller can't reintroduce the behaviour.
- **Consequence accepted:** Reverses the original "Skills second, reorderable by the user" from the first Stage 10 spec.
- **Status:** ✅ Landed in Stage 10 review 2.

### 2026-08-21 (review 2) — Disabling Skills is a read-time filter, not a bulk write
- **Decision:** `folders.is_enabled` (synced, new column). A disabled folder is hidden from the sidebar, and its notes are excluded by an additional predicate inside `lib/plaintext/broker.ts` and `lib/plaintext/mcp.ts` — a recursive CTE over the subtree, shared from `lib/powersync/folderQueries.ts`.
- **Reasoning:** The brief asked disabling to make the notes invisible to apps. Implementing that as a bulk write over `is_hidden_from_api` would be lossy — re-enabling could not restore which notes the user had hidden by hand, so it would silently expose notes meant to stay hidden. A flag consulted at read time is reversible with no data loss.
- **Not a parallel mechanism:** it is a *stricter* predicate on the query that already existed, at the same chokepoint. It can only remove rows, never add them, so it cannot widen access, and nothing bypasses the broker. `scripts/verify-plaintext-gates.ts` still passes unchanged.
- **Consequence accepted:** a disabled folder whose Include-in-Notes is on still has its notes in All Notes — the folder is hidden, not its content.
- **Status:** ✅ Landed in Stage 10 review 2, with the reversibility property covered by `scripts/verify-folders-local.ts`.

### 2026-08-21 (review 2) — The Skills "Visible to Apps" item is a bulk write, and says so
- **Decision:** The Skills context menu's Visible-to-Apps item writes `is_hidden_from_api` across the whole Skills subtree, overriding per-note choices. The label reports the aggregate first, including a "some hidden" state when the notes disagree.
- **Reasoning:** "Affecting all its contents" is what a bulk action means, and there is no way to honour that while also preserving the flags it overwrites. Keeping it a bulk write over the existing column means `is_hidden_from_api` stays the only answer to "why is this note hidden from apps?".
- **Consequence accepted:** destructive of individual decisions, deliberately — which is why it is a distinct tool from disabling the folder, and why the two are documented side by side.
- **Status:** ✅ Landed in Stage 10 review 2.

### 2026-08-21 (review 2) — Header shape and folder-pane presentation are separate questions
- **Decision:** `useCompactHeader` (phone) and `foldersArePersistent` (pane pushes content) replace the single flag that drove both.
- **Reasoning:** The iPad screenshots require the wide header with a floating overlay panel — a combination the single flag could not express. It also caused a real bug: the folder pane's `!selectedNoteId` guard, correct on a phone, meant the reveal control did nothing at all on an iPad, where the editor always has a note open.
- **Status:** ✅ Landed in Stage 10 review 2.

### 2026-08-21 — Import source is a directory picker
- **Decision:** Import takes a directory; hierarchy is reconstructed from its structure. Not file-by-file, not `.zip`.
- **Reasoning:** Folder structure is the point of the feature — a flat import loses the organization the export preserved.
- **Consequence accepted:** Directory picking is unevenly supported on mobile. Stage 15's prompt requires escalation rather than a silent fallback to file-by-file if a platform can't support it.
- **Status:** ❌ Superseded — see the "Import and export both switch to `.zip`" entry below.

### 2026-08-21 (review 3) — Import and export both switch to `.zip` on every platform
- **Decision:** Both operations now use a single `.zip` file as the transfer unit everywhere, replacing the bare-directory export and the directory-picker import. Internal structure (nested folders, Markdown files) is unchanged — only the container changed. Added on top: an "Imported" vs. "All Notes" placement toggle for where imported content attaches, and a rule to collapse pass-through wrapper folders (an empty folder holding only subfolders) during import.
- **Reasoning:** Directory picking's uneven mobile support (flagged as an open risk when the directory-picker decision was made) turned out to be avoidable entirely rather than something to design around — a zip is one file, so both import and export collapse to a plain file-picker/share-sheet round trip on every platform, with no per-OS branching needed.
- **Consequence accepted:** A zip library becomes a new app dependency (none existed before) — flagged in the Stage 15 prompt as requiring Plan Mode approval rather than a silent pick. Export also loses the "raw folder you can browse in Files" ergonomic in favor of "download and unzip" — considered a worthwhile trade for eliminating the mobile directory-picker gap.
- **Status:** Decided, lands in Stage 15.

### 2026-08-21 (review 3) — Import Folder toggle defaults to "All Notes"; "Imported" is one folder, always reused
- **Decision:** The Import Folder placement toggle defaults to `All Notes` — imports attach at the top level unless the user explicitly switches the toggle to `Imported`. When `Imported` is used, every import reuses the same single persistent top-level "Imported" folder; it is never recreated or numbered per run.
- **Reasoning:** Imports shouldn't land inside a separate "Imported" folder unless the user asked for that — `All Notes` is the natural default. Once a user does opt into `Imported`, reusing one folder keeps repeated imports simple and consistent with how the existing note-level collision rules (duplicate/skip/overwrite) already behave — no separate per-run naming scheme to invent or collide with.
- **Status:** Decided, lands in Stage 15.

### 2026-08-21 (review 3) — "PersonOS design system" dropped from Stage 14
- **Decision:** Removed as a design-inspiration reference for the website. No trace of it existed anywhere in this repo, and rather than blocking Stage 14 on tracking it down, it's simply left out — easlo.co/apps/experiments and the apple-design-system skill remain the inspiration references.
- **Status:** Decided.

### 2026-08-21 (review 4) — The icon-button system lands in Stage 12, and Stage 12 owns every icon button
- **Decision:** Feedback on icon sizing, container shape, borders and hover/press states is folded into **Stage 12**, whose scope is widened from "style this stage's own chrome" to "define one icon-button primitive and convert the whole app to it." Rules recorded: one icon = circle, 2+ grouped = a single capsule, confirm action = filled accent circle standing alone; three states (rest / hover / press, press more prominent than hover); one glyph size everywhere except `FolderRow`'s deliberate depth-based shrink.
- **Reasoning:** Stage 12 was already the nearest planned home ("Apple-style hover/click animations throughout… pill touch targets ≥44px"), but that line was too vague to build against and scoped only to Stage 12's own bars. An audit of `main` @ `b586da5` found **7 different container treatments and 6 glyph sizes** already in the tree, so this is a systemic gap, not a back-button bug.
- **Root cause of "the back button container seems too large":** `HeaderCircleButton` paints a 44×44 circle because 44pt was read as the HIG minimum *painted* size. It is the minimum *touch* target. Paint smaller, restore the target with `hitSlop`.
- **Consequence accepted:** the oversized back button and the app-wide inconsistency **stay visible through Stage 11** rather than being patched now. Patching it now would mean guessing a diameter that Stage 12 then re-derives from the reference shots — churn on a number that has to change twice.
- **Cross-stage deferral — settled 2026-08-21, lands in Stage 12:** Stage 11 builds a circular Done button, floating bulk-action pills, and a filled context-menu icon row — the same three primitives. Recommendation was to build the primitive early in Stage 11; **decided instead to keep it in Stage 12**, where the rest of the menu-chrome work lives and the whole app gets converted in one pass rather than a primitive landing early and being extended piecemeal.
- **Consequence accepted:** Stage 11's three shapes are built locally and **will be rewritten in Stage 12** — known rework, chosen deliberately over splitting the design system across two stages. Mitigations written into both stage prompts: Stage 11 keeps them deliberately dumb, must not touch `HeaderCircleButton`/`PressableScale`, and must list every icon button it adds with `file:line` so Stage 12 inherits a conversion list instead of re-auditing.
- **Reference shots:** ✅ resolved — all three committed to `dev-docs/design/iteration-2/floating-menu/icon-buttons-*.png`, so the normal "screenshots are authoritative over prose" rule applies here after all. Reading them corrected one rule: grouping is **semantic, not spatial** — Undo keeps its own circle beside a Share/`…` capsule, so adjacency does not merge controls.
- **Status:** Recorded, lands in Stage 12 (primitive possibly earlier, via Stage 11).

### 2026-08-21 (Stage 11) — Swipe/menu action colours translate Apple's palette rather than copying it

**Decision:** Pin uses the app's lime accent; Delete uses the existing `destructive` red. Share and Move take Apple's own blue and indigo, because the reference assigns two distinct blues to two adjacent buttons and collapsing them would make the pair unreadable.
**Reasoning:** Apple's Pin is yellow because yellow *is* their accent — so the faithful translation of "Pin uses the accent" is lime here, not amber. Share/Move had no such mapping, and inventing one risked two neighbouring capsules that look the same.
**Consequence accepted:** two colours enter the app that no token covers (`blue-500`, `indigo-500`), used the same way the lime already is — stock Tailwind classes rather than semantic tokens. No `global.css` change was needed. Revisit if a semantic action palette is ever introduced.
**Status:** built.

### 2026-08-21 (Stage 11) — Search and New Note stay in the list pane until Stage 12 moves them

**Decision:** Stage 11 does not remove the bottom search field and New Note button from wide layouts, despite the reference showing them gone.
**Reasoning:** Stage 12 is what relocates them into the editor chrome. Removing them first would leave desktop and iPad with no way to create a note or search at all for a whole stage — a functional regression, not the cosmetic gap the spec anticipated.
**Consequence accepted:** this stage's desktop and iPad result does not match the reference screenshots at the bottom edge. Stage 12 must delete the leftover bar rather than assume it is already gone. The bar IS hidden inside select mode, where it would collide with the floating bulk pills and means nothing anyway.
**Status:** built.

### 2026-08-21 (Stage 11) — All Notes always groups by date

**Decision:** `Group By Date` stays a per-folder setting for real folders; All Notes ignores it and always groups.
**Reasoning:** All Notes is not a folder row, so it has nowhere to hang a toggle, and every reference shot of it is grouped. A second, global setting answering the same question is how a folder and All Notes end up disagreeing about one note.
**Consequence accepted:** All Notes cannot be un-grouped. Cheap to reverse — it is one branch in `listGroupByDate`.
**Status:** built.

### 2026-08-21 (Stage 11) — Bulk delete confirms; single delete does not

**Decision:** The select-mode Delete pill raises a confirmation naming the count. Swipe-left Delete and the context menu's Delete stay silent.
**Reasoning:** One note going to trash is obvious and one tap from being restored. Forty disappearing at once is neither, and the gesture that triggers it is the easiest to fire by accident.
**Consequence accepted:** the two paths behave differently for what is nominally the same verb.
**Status:** built.

### 2026-08-21 (Stage 11) — `react-native-gesture-handler` stays on Expo's pinned 2.28.0

**Decision:** Bumped to 2.32.0 mid-stage to chase apparently-dead swipe gestures, then reverted to `~2.28.0`.
**Reasoning:** The gestures were never broken. Programmatic touch injection into the iOS Simulator drives React Native's own touch handling but does not fire `UIGestureRecognizer`s, so every automated swipe registered as a tap. Verified by hand: the swipe works. Expo SDK 54 pins `~2.28.0` and `expo install --check` is clean there, so there was no reason to deviate.
**Consequence accepted:** two native rebuilds spent on a non-existent bug. Recorded so the same dead end is not re-entered — when gestures look inert but the native module, pod linkage, Fabric registration and root view all check out, test by hand before touching a dependency.
**Status:** reverted, back on 2.28.0.

### 2026-08-21 (Stage 11) — Move gained an "All Notes" destination; `sharedFolderId` needs three states

**Decision:** The folder picker (sheet and desktop flyout both) gets an **All Notes** row above New Folder, which files the notes under no folder at all. `notes.folder_id` was already nullable, so this is UI plumbing over an existing shape — no migration.
**Reasoning:** Every Move entry point could put a note INTO a folder and none could take it back out. Unfiled is a real, reachable state in this app (notes predating folders, notes whose folder was deleted), so it needed a deliberate way in, not just an accidental one.
**Consequence accepted:** `sharedFolderId()` had to stop returning `null` for two different facts. It now returns a folder id, `null` for "all these notes are unfiled", or `undefined` for "they disagree". Collapsing those again would enable All Notes for notes already unfiled and disable it for a mixed selection, which is exactly backwards.
**Verification:** all three states exercised on device and the destination confirmed server-side — `select folder_id from public.notes` returns NULL for the moved note, so it uploaded rather than merely rendering.
**Status:** built.

### 2026-08-22 (Stage 11) — `ReanimatedSwipeable` was adopted, then reverted; the swipe row stays hand-rolled

**Decision:** Migrate `SwipeableNoteRow` to gesture-handler's `ReanimatedSwipeable` as agreed, then **revert to the hand-rolled `Gesture.Pan()`** once the migration proved to be a functional regression. All four requested refinements ship on the hand-rolled version instead.
**Reasoning:** Three findings, all from testing on an Android emulator rather than from reading docs:
1. **Its left-hand action could not be tapped.** Pin rendered correctly and never fired, while Share/Move/Delete on the right worked every time. The library lays both action panels out as `StyleSheet.absoluteFillObject` siblings that each cover the whole row. Rendering only the active side did not fix it, so the overlap is not the whole story — but the regression reproduced on every attempt.
2. **It silently ignores `activeOffsetX` / `failOffsetY`.** They are not gesture config on this component; they fall through `...remainingProps` onto a plain `View`. The pan is built from its own `dragOffsetFromLeftEdge`/`dragOffsetFromRightEdge`. So the guards that stop a swipe fighting the SectionList's vertical scroll were inert the whole time it was in place.
3. **No full-swipe-to-commit** ([discussion #2520](https://github.com/software-mansion/react-native-gesture-handler/discussions/2520)) — which the hand-rolled version already had working, via `COMMIT_FRACTION_RIGHT`/`COMMIT_FRACTION_LEFT`.
**Consequence accepted:** the app keeps ~200 lines it owns rather than delegating to a maintained library, and that file is now where any future swipe bug has to be fixed. Bought in exchange: both sides work, the scroll guards actually apply, and force-swipe-to-commit ships **now** rather than at the end of the iteration. The colour shift on the outermost action is therefore a true **armed** indicator (above reveal 1.0, in the commit region), not the weaker "fully revealed" signal a deferred commit would have forced.
**Verification:** on Android — Pin fires and the row moves into the Pinned section; Share opens the system share sheet; Move opens the folder picker; the three left-side capsules match `mobile-swipe-left-actions.png` at a measured ~62x44pt.
**Status:** reverted and shipped hand-rolled.

### 2026-08-21 — The editor moves to HTML-native, not markdown

**Decision:** Replace TenTap with `react-native-enriched-html` (Stage 11.5), keeping **HTML** as the stored note-body format. Reject `react-native-enriched-markdown` and `react-native-streamdown`.
**Reasoning:** Decided by the design references, not by preference. `formatting-toolbar-desktop.png` and `mobile-navbar-default-aa-undo-redo.png` show **underline**, **highlight** and **text colour** — none of which exist in CommonMark or GFM. Markdown storage would silently drop controls the authoritative screenshots show, and would additionally require converting every existing note body through the encryption layer. Streamdown was never a candidate: it is a read-only streaming renderer for AI chat output with no input component. HTML also means **zero migration** — the new editor reads and writes the format the notes are already in.
**Consequence accepted:** `react-native-enriched-html` supports **one level of lists only**. Stage 12's planned indent/outdent on list items may ship flat or wait on upstream — the Phase 0 spike settles which. Web support is also marked experimental, which Stage 13 depends on; the spike checks it before Stage 13 builds on the assumption.
**Status:** planned, Stage 11.5, spike-first.

### 2026-08-21 — The editor stays always-editable; no view/edit mode split

**Decision:** No separate view mode. Tap a note and the cursor lands, as now.
**Reasoning:** Apple Notes — the design reference for this whole iteration — has no view mode, and every editor screenshot in `dev-docs/design/iteration-2/` shows a live editor. The yellow ✓ in `mobile-navbar-default-aa-undo-redo.png` is keyboard-dismiss, not a mode switch. Stage 12's design assumes editing is the default state.
**Consequence accepted:** gives up two real benefits a split would have had — cheaper scrolling on very long notes, and a read path for web if the new input's experimental web support doesn't hold. If Stage 11.5's spike finds either problem is severe, this comes back rather than being worked around silently.
**Status:** decided.

### 2026-08-21 — Adopting `@swmansion/react-native-bottom-sheet`, `react-native-reanimated-dnd` and Pulsar

**Decision:** Three additions. Bottom-sheet and DnD land together in the new Stage 12.5; Pulsar folds into Stage 12's icon-button work.
**Reasoning:** The bottom sheet retires all three Gluestack modal traps rather than working around them in each new sheet. DnD replaces arrow buttons that were always a placeholder for dragging. Pulsar is patterned haptics where the app currently fires one-shots, and is small enough not to justify a stage.
**Consequence accepted:** three new native dependencies and a native rebuild. `react-native-reanimated-dnd` is a **community** project, not Software Mansion's, so its support expectations differ from the rest of the stack — flagged rather than assumed. Folder drag stays **top-level only**, preserving Stage 10's logged scope.
**Status:** planned.

### 2026-08-22 — ~~Editor stays TenTap~~ **SUPERSEDED** by the entry below (Stage 11.5 shipped)

> Left in place deliberately. The findings were accurate and reproduced; the
> recommendation was wrong because it judged the library against a bar Adam had
> not set. Deleting it would hide that, and the same mistake is easy to repeat.

- **Decision:** Stage 11.5 does not run. Do not replace `@10play/tentap-editor`. The TenTap workarounds (the `react-dom` 18→19 `overrides` block, the empty-document handling in `types/note.ts`) stay, because they are only removable when TenTap is.
- **Reasoning:** The spike was executed for real — library installed, iOS rebuilt natively, real note HTML round-tripped through `EnrichedTextInput`, results captured as exact strings rather than screenshots, whole run repeated. It fails on this app's data. `setValue()` decides HTML-vs-plain-text by **input string length**, escaping anything ≤~12 characters into visible literal text: `<h1>r</h1>`, a real note here, became `<p>&lt;h1&gt;r&lt;/h1&gt;</p>`. That hits every new note and every short title-only note, and breaks `isBlankNote()`, which gates permanent deletion. Nested lists are also silently flattened, and `<mark>`/`<span style="color">` are dropped.
- **Consequence accepted:** the WebView editor stays, so Stage 13's web-parity problem is unchanged and the `react-dom` override remains in `package.json`. Stage 12's toolbar is built against TenTap's bridge, as planned before 11.5 was inserted.
- **What this overturns:** the 2026-08-21 decision "the editor moves to HTML-native, not markdown" rested on HTML being able to carry underline, highlight and colour where Markdown cannot. This library carries underline only — highlight and colour are dropped in *both* formats. The premise did not hold for the actual candidate. Recorded rather than quietly dropped, because if the editor question reopens, that argument must not be reused as-is.
- **Verification:** `docs/editor-migration-findings.md`, with the exact length-threshold table and the real-note round trips.
- **Status:** NO-GO, recorded. Revisit only if the length heuristic is fixed upstream AND nested lists and highlight arrive.

### 2026-08-22 (Stage 11 polish) — force-swipe-to-commit was dead code, and the armed colour was measuring the wrong thing

- **Decision:** the swipe row now keeps moving past the revealed strip (`OVERSHOOT_RATE` 0.85, capped at the row width), `COMMIT_FRACTION_LEFT` drops 0.9 → 0.75, and the outermost action's colour is driven by progress toward the COMMIT threshold rather than toward full reveal. A one-shot haptic and a small icon scale mark the armed moment.
- **Reasoning:** `onUpdate` clamped `translateX` to the revealed strip — 216pt left, 72pt right — while `onEnd` tested the commit against a fraction of the ROW width (~334pt and ~204pt of a 371pt row). Neither test could ever be true. Force-swipe-to-commit read as implemented and had never fired on a device. Found only by trying to verify the armed colour and realising no drag could reach it. 0.9 then had to come down as well, because with the easing it needed more finger travel than the screen has.
- **Consequence accepted:** committing a swipe-left now takes ~289pt of travel on a ~371pt row — deliberately most of the width, so "look at Share" and "delete this note" stay obviously different gestures. The colour shift stays subtle (Tailwind 500 → 600) because the request was that it change *slightly*.
- **Correction to the record:** the 2026-08-22 entry above says the hand-rolled implementation "already had force-swipe working". That was read off the source, not verified, and it was wrong. It is working now.
- **Verification:** on Android, a force-swipe left trashed a note with no button tap (count 3 → 2); the test note was restored afterwards. **iOS force-swipe is still unverified** — the gesture cannot be automated there (see `/dev-swipe` and the simulator memory note), so it needs one drag by hand.
- **Status:** built and verified on Android; iOS gesture needs a hand check.

### 2026-08-22 — Stage 11.5 shipped after the NO-GO was overridden

- **Decision:** Adam overrode the spike's NO-GO. TenTap is replaced by `react-native-enriched-html`. Backwards compatibility is explicitly not a blocker; what matters is that new notes work well and the editor is native and fast.
- **What that changed:** the spike judged the library against "must preserve everything", which it fails. Judged against "old notes must survive readably, new notes must be good", it passes — and the migration turned out **better** than the two fallbacks offered (wrap old notes in a code block, or keep the escaped HTML). Wrapping a legacy body in `<html>…</html>` both clears the length threshold that was corrupting short notes AND parses correctly, so old notes come through as real formatted content rather than as literal markup.
- **The lesson worth keeping:** the NO-GO was not wrong on the facts — every finding in `docs/editor-migration-findings.md` reproduced. It was wrong on the *bar*. A spike that measures faithfully can still recommend the wrong thing if it is holding the work to a standard the owner never set.
- **Consequence accepted:** nested lists flatten to one level, task-list checked state is lost, `<pre><code>` becomes a non-standard `<codeblock>`. Tiptap remains an indirect dependency of the new library's **web** build, so "no tiptap" is true on native only.
- **Stage 12 consequence:** highlight and text colour cannot be represented — not by this library, not by markdown. Stage 12's toolbar reference shows both. That has to be resolved in Stage 12. Underline is newly available and shipped.
- **Verification:** on iOS, a legacy note opens and renders, typing works, the save encrypts and reaches Postgres, the list updates, and pin round-trips server-side. 86 unit tests including the migration's idempotence.
- **Status:** shipped.

### 2026-08-22 — iPad pass (Stage 11), and a launch race it uncovered

- **Checked:** iPad Pro 13-inch, dark and light. The list pane and editor render as a persistent split, the folder sidebar is collapsed behind its toggle, the date group carries the **desktop separator**, and the open note carries the **lime accent border**.
- **This partially closes the checkpoint item recorded as blocked.** "Desktop shows the accent border on the current note only" could not be verified on web, which does not boot until Stage 13 — but iPad inherits the desktop structure and shows it correctly, so the rule itself is confirmed working. Web remains unverified as a platform.
- **Found and fixed a real bug that had nothing to do with iPad:** a fresh device created **two** empty notes. `autoCreateIfTrulyEmpty` claimed its guard ref *after* an await, so all three callers (notes watch, auth resolving, first sync) could pass the check before any set the flag. Only reproducible on a genuinely empty database, which is why months of use never surfaced it. Verified fixed by uninstalling to wipe local SQLite and relaunching: one note.
- **Not covered:** landscape/portrait rotation behaviour. `simctl` has no clean rotation hook and it needs a hand. The standing rule (split-view in landscape, overlay in portrait) is therefore still unverified for the FOLDER sidebar specifically.
- **Status:** iPad structurally verified; rotation outstanding.

### 2026-08-22 — Swipe stopped engaging; the maths moved out of the component and under test

- **Symptom Adam reported:** "I'm failing to swipe on any iOS note, it's just slightly budging but not moving."
- **Three causes, two of them introduced by the force-swipe commit the day before:**
  1. The overshoot easing collapsed for drags SHORTER than the revealed strip. `beyond = max(0, magnitude - limit)` is 0 below the strip, so `eased` became `limit` — the 1:1 branch was simply missing.
  2. `failOffsetY([-12, 12])` cancelled the gesture as soon as a thumb drifted 12pt vertically, and a thumb always drifts. Widened to `[-40, 40]`; `activeOffsetX` still sends clearly-vertical drags to the list's scroll.
  3. The helpers run in `Gesture.Pan` worklets on the UI thread and threw once imported across a module boundary without a `'worklet'` directive.
- **Decision:** the arithmetic now lives in `lib/notes/swipeMath.ts` with 16 tests, not inline in the component. It has shipped wrong twice — first a clamp that made the commit unreachable, then the collapsed easing — and both are obvious the moment real numbers go through them, with no device required. One test asserts specifically that the commit threshold is reachable by a drag that fits on the screen.
- **Consequence accepted:** a little indirection between the component and its numbers, in exchange for the class of bug that cost two device-debugging sessions becoming a unit test.
- **Verification:** Android, by real gesture. **iOS is still unverified — gestures cannot be automated on the simulator** (injected touches never reach `UIGestureRecognizer`s), so this needs one drag by hand.
- **Status:** built; iOS needs a hand check.

### 2026-08-22 — Highlight and text colour deferred to Stage 12, extended in the library's own idiom

- **Decision:** neither `react-native-enriched-html` nor markdown can represent **highlight** or **text colour**, both of which appear in `floating-menu/formatting-toolbar-desktop.png`. Rather than drop them, Stage 12 extends the editor with custom tags styled through the library's own `htmlStyle` API — following its feature-design style rather than layering a hack beside it.
- **Why Stage 12 and not now:** Stage 12 *is* the formatting-toolbar stage, and that screenshot is one of its own references. Building the extension mechanism before the toolbar that consumes it means designing against an imagined caller.
- **What Stage 12 must handle:** overlapping marks, undo/redo across a custom tag, and round-tripping the custom tag through `setValue`/`getHTML` unchanged. Adam: "can always do more hardening at the end of the stage."
- **Also lost and needing a Stage 12 answer:** indent/outdent. The new editor exposes no indent API, and nested lists flatten to one level.
- **Status:** deferred, recorded.

### 2026-08-22 — Web/native content compatibility is a Stage 13 Phase 0 gate

- **Decision:** add an explicit question to Stage 13 Phase 0 — *does `EnrichedTextInput` on web emit byte-identical HTML to native for the same edits?* — and answer it by measurement there.
- **Reasoning:** the library's web support is marked **experimental**, and its own material describes web as "a subset guaranteed to render and parse identically". That is exactly the kind of claim to measure rather than trust, and it cannot be measured yet because web does not boot (the known `Appearance.setColorScheme` failure Stage 13 owns). A divergence would mean a note edited on web and then on phone disagrees about its own markup.
- **Consequence accepted:** until Stage 13 runs, cross-platform content parity is asserted by the vendor, not verified by us. Native-to-native (iOS ↔ Android) IS verified — a note edited on iOS renders and syncs correctly on Android.
- **Status:** recorded as a Stage 13 gate.
