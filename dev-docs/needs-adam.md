# Needs Adam

The running list of things I cannot do myself. Kept here rather than in chat so
it survives a `/clear`. Each item says **why** I cannot do it, so the list can be
challenged rather than taken on trust.

Updated 2026-08-27, against `main` @ the Stage 13e merge.

---

## 1. Grant Accessibility to Claude Code  ·  *unblocks the last iPad check*

**System Settings → Privacy & Security → Accessibility** → enable the **claude**
entry (the same one you enabled under Automation).

**Why me:** an OS permission dialog. This is a THIRD, separate grant — Automation
(`-1743`) is done; UI scripting needs Accessibility, which fails with a different
code:

```
execution error: osascript is not allowed assistive access. (-1728)
```

**What it unblocks:** rotating the iPad simulator, the only way to see the
landscape folder column rendered. Portrait is now verified (a shutdown/boot
resets a simulator to portrait, which needed no permission); landscape is the
one case left, and writing the orientation into the Simulator's plist does not
work because it rewrites it on quit.

Low priority — landscape is the same code branch as desktop, which is verified,
and all 14 unit tests pass. It is the last unrendered case, not a suspected bug.

---

## 2. Decide: should an Android tablet in portrait match the iPad?  ·  *a real question*

Today `folderPanePresentation` is `platform !== 'ios' || isLandscape`, so a
portrait Android tablet gets the pushed-aside **column** while an iPad of
identical dimensions gets the floating **overlay**. Same window, same shape,
different answer.

It looks like an accident of writing the condition against iOS rather than
against the shape of the window, but changing it changes visible behaviour on
Android, so it is yours. Pinned in a test either way. Two lines to switch.

---

## 3. Exercise the passkey on your Mac

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
