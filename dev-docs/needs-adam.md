# Needs Adam

The running list of things I cannot do myself. Kept here rather than in chat so
it survives a `/clear`. Each item says **why** I cannot do it, so the list can be
challenged rather than taken on trust.

Updated 2026-08-27, against `main` @ the Stage 13e merge.

---

## 1. Deploy the `user_settings` stream in PowerSync Cloud  ·  *blocks a shipped feature*

**Where:** the PowerSync Cloud dashboard for the live instance.

**Why me:** `powersync/sync-streams.yaml` is the reviewable copy in git, not the
deployed one — `docs/two-stacks.md` states the dashboard is the source of truth
for what is actually running live. There is no CLI in this repo that deploys it.

**The config edit is saved but was never DEPLOYED.** Adam's dashboard shows the
most recent entry in Deploy History as **Aug 9, 21:43** — 18 days stale — while
the status card still reports `Sync Streams: 2 (a2b1)` as Active. Left nav →
**Sync Streams** → confirm the YAML → press **Deploy**. Deploy History should
gain a new entry and the card should read `3`.

Also confirm the instance selector (it reads **"Development"**) is the one
`EXPO_PUBLIC_POWERSYNC_URL` actually points at, or the deploy lands elsewhere.

**What the stream should be**, matching the two already there:

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

## 1b. OPEN BUG — Settings unreachable on the iPad  ·  *reported 2026-08-27, not yet investigated*

Adam, while doing item 1: sync set up on the iPhone and iPad simulators, set
Dark on one, it did not reach the iPad — **and "there seems to be a bug
preventing me from checking the settings"**.

**The non-syncing half is almost certainly item 1, not a bug.** The dashboard
still reports `Sync Streams: 2`, so `user_settings` is not deployed; the row
never leaves the server and appearance stays device-local. That is what a
missing stream looks like.

**The "cannot check the settings" half is a real and separate report** and is
the one to chase. Detail still needed: does the Settings sheet fail to open, open
and stay empty, or open and crash — and on which device. Suspects, in order:

1. `SettingsDialog` now calls `useInstallPrompt()` (Stage 13d). Its native
   implementation is a plain function, but it is called unconditionally on every
   platform — worth confirming it is harmless on a native modal.
2. `SecurityView` gained `Platform.OS === 'web'` branches and imports
   `getDeviceKey()` from the vault (13b). `getDeviceKey()` **throws when the
   vault is locked**, and the native path calls it in `handleLockToggle` — which
   should be unreachable natively, but that needs proving rather than assuming.
3. The appearance settings moved onto the synced layer in 13c; a failed read
   there would surface when the Appearance view mounts.

Deliberately not fixed yet at Adam's request — batched with the item 1 retry.

---

## 2. Exercise the passkey on your Mac  ·  *now unblocked*

Settings → Security → Require unlock → **Use a passkey**, then lock and unlock.

**Previously blocked by a bug of mine**, now fixed: the Settings sheet was
rendering *inside the note-list column* under the editor, so it could not be
reached. See the ModalSheet note in the build plan.

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
- ~~Automation permission for Simulator itself~~ — granted.
- ~~Automation permission for System Events~~ — **closed 2026-08-27.** The grant was correct all along; the *running* Claude Code process was version 2.1.235, whose binary had been deleted by a self-update to 2.1.237, so its TCC identity matched nothing and every Apple event failed with `-1743` and no prompt. Restarting the app fixed it. Simulator rotation is now available to me for the first time.
- ~~Check the PWA in a real Chrome~~ — **done 2026-08-27.** Service worker registers, installs, and runs offline on the desktop. Two real bugs found and fixed (offline shell served an uncached bundle; `persisted()` handling).
- ~~"iPad app crashing after load"~~ — **not a bug.** Metro was not running; a dev build with no packager paints a blank screen. Confirmed working once 8081 was back up.
