# Needs Adam

The running list of things I cannot do myself. Kept here rather than in chat so
it survives a `/clear`. Each item says **why** I cannot do it, so the list can be
challenged rather than taken on trust.

Updated 2026-08-27, against `main` @ the Stage 13e merge.

---

## 1. Add the `user_settings` stream to PowerSync Cloud  ·  *blocks a shipped feature*

**Where:** the PowerSync Cloud dashboard for the live instance.

**Why me:** `powersync/sync-streams.yaml` is the reviewable copy in git, not the
deployed one — `docs/two-stacks.md` states the dashboard is the source of truth
for what is actually running live. There is no CLI in this repo that deploys it.

**What to add**, matching the two streams already there:

```yaml
  user_settings:
    auto_subscribe: true
    query: SELECT * FROM user_settings WHERE user_id = auth.user_id()
```

**Until then:** live devices sync notes and folders but never settings, so the
lock setting, appearance, theme and bullet style stay device-local on the iPad
and the Android phone. Nothing errors — every container reports healthy — which
is exactly why this is easy to miss.

The Postgres half is already done: you pushed the migration, and I confirmed it
against the live REST endpoint (`42501` for `anon`, identical to `folders`).

---

## 2. Grant Automation permission for **System Events**  ·  *unblocks my testing*

**Where:** System Settings → Privacy & Security → Automation → the terminal /
Claude entry → tick **System Events**.

**Why me:** this is an OS permission dialog. Note it is a *different* entry from
the one you already granted: `osascript -e 'tell application "Simulator" to
activate'` now succeeds, so Simulator itself is authorised. Anything driving the
keyboard or menus goes through System Events, which still fails:

```
execution error: Not authorized to send Apple events to System Events. (-1743)
```

**What it unblocks:** simulator rotation (⌘← / ⌘→), which is the only way to
verify the iPad's landscape/portrait rule — the folder sidebar is a split-view
column in landscape and an overlay in portrait, and that rule has been unverified
since Stage 11. It should also stop `expo run:ios` exiting 1 on success, which it
does purely because it shells out to `osascript` to front the window.

---

## 3. Check the PWA in a real Chrome  ·  *verifies written-but-unrun code*

```bash
npm run build:web
node <a static server over HTTP/1.1>   # NOT python -m http.server
```

Then open it, install from the omnibox, and check: the app still opens with the
network off, and `navigator.storage.persisted()` returns `true` afterwards.

**Why me:** service workers cannot register in the automated browser at all — a
*trivially valid empty worker* fails with the identical error as a file that does
not exist, so it is not fetching. That makes registration, the offline shell,
`beforeinstallprompt` and `persist()` all unverifiable here.

**Why not Python's `http.server`:** it speaks HTTP/1.0 and Chrome's service
worker script fetch fails against it. That cost me an hour of chasing my own
code; the registration bug I *did* find was real, but this masked it.

---

## 4. Exercise the passkey on your Mac or phone  ·  *you have already accepted this*

Settings → Security → Require unlock → **Use a passkey**, then lock and unlock.

**Why me:** no platform authenticator exists in the automated browser, so
`isBiometricGateAvailable()` is false and the setup dialog correctly offers only
a PIN. Enrolment, PRF evaluation and passkey unlock type-check and have **never
executed**. The PIN path is fully verified, including the 10-attempt
self-destruct and its recovery.

If PRF misbehaves, the PIN path is unaffected — they are separate branches in
`lib/crypto/webGate.ts`.

---

## Done, kept briefly so they are not re-raised

- ~~Drag a folder on the phone to confirm the reorder survives a sync round-trip~~ — done 2026-08-27, worked.
- ~~`supabase db push` to live~~ — done 2026-08-27, verified against the live REST endpoint.
- ~~Automation permission for Simulator itself~~ — granted; only System Events is still missing (item 2).
