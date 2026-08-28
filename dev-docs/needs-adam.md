# Needs Adam

The running list of things I cannot do myself. Kept here rather than in chat so
it survives a `/clear`. Each item says **why** I cannot do it, so the list can be
challenged rather than taken on trust.

Updated 2026-08-27, against `main` @ the Stage 13e merge.

---

## 1. Exercise the passkey on your Mac  ·  *the only item left*

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
- ~~Deploy the `user_settings` stream~~ — **done 2026-08-28.** I misread the status card: `Sync Streams: 2 (a2b1)` is a VERSION and a config hash, not a count of two streams. The deploy had already happened.
- ~~Settings not reaching the iPad~~ — **not one bug but three, all mine, all fixed 2026-08-28.** See the build plan's 13c entry.
- ~~"iPad app crashing after load"~~ — **not a bug.** Metro was not running; a dev build with no packager paints a blank screen. Confirmed working once 8081 was back up.
