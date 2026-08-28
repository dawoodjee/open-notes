# Needs Adam

The running list of things I cannot do myself. Kept here rather than in chat so
it survives a `/clear`. Each item says **why** I cannot do it, so the list can be
challenged rather than taken on trust.

Updated 2026-08-27, against `main` @ the Stage 13e merge.

---

## Nothing is currently blocked on Adam.

All three open items were closed on 2026-08-28.

**One recurring environmental note, not a task.** Claude Code self-updates and
deletes the binary the running session is executing, which silently voids its
TCC identity — every Apple event then fails with `-1743` and no prompt, however
the Automation and Accessibility checkboxes are set. It has happened twice
(2.1.235 → 2.1.237, and 2.1.246 → 2.1.247). **Quitting and reopening Claude
fixes it**; no permission work is needed. The symptom to recognise is
`osascript` suddenly failing mid-session having worked minutes earlier.

## Done, kept briefly so they are not re-raised

- ~~Grant Accessibility~~ — granted. Rotation is available whenever the session's binary has not been replaced by a self-update (see the note above).
- ~~Decide whether an Android tablet in portrait should match the iPad~~ — **decided: yes, make it uniform.** The rule now answers on window shape alone and never on platform. See the build plan entry.
- ~~Exercise the passkey on your Mac~~ — **done, works.** Enrolment *and* unlock both verified, so the WebAuthn PRF path is no longer theoretical: the same PRF output comes back on a second evaluation, which is precisely the part that could not be established by reading the code.

- ~~Drag a folder on the phone to confirm the reorder survives a sync round-trip~~ — done 2026-08-27, worked.
- ~~`supabase db push` to live~~ — done 2026-08-27, verified against the live REST endpoint.
- ~~Automation permission for Simulator itself~~ — granted.
- ~~Automation permission for System Events~~ — **closed 2026-08-27.** The grant was correct all along; the *running* Claude Code process was version 2.1.235, whose binary had been deleted by a self-update to 2.1.237, so its TCC identity matched nothing and every Apple event failed with `-1743` and no prompt. Restarting the app fixed it. Simulator rotation is now available to me for the first time.
- ~~Check the PWA in a real Chrome~~ — **done 2026-08-27.** Service worker registers, installs, and runs offline on the desktop. Two real bugs found and fixed (offline shell served an uncached bundle; `persisted()` handling).
- ~~Deploy the `user_settings` stream~~ — **done 2026-08-28.** I misread the status card: `Sync Streams: 2 (a2b1)` is a VERSION and a config hash, not a count of two streams. The deploy had already happened.
- ~~Settings not reaching the iPad~~ — **not one bug but three, all mine, all fixed 2026-08-28.** See the build plan's 13c entry.
- ~~"iPad app crashing after load"~~ — **not a bug.** Metro was not running; a dev build with no packager paints a blank screen. Confirmed working once 8081 was back up.
