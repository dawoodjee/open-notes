# Building the app

For iOS/iPadOS and Android, from source. Two paths per platform: a **development
build** you run on your own device while editing code, and a **distributable
build** you install and keep.

You need a backend first — either [self-host one](self-hosting.md) or point at
one you already have. The app cannot be built without `EXPO_PUBLIC_*` values.

---

## Expo Go will not work, and it is not a configuration problem

Expo Go is a pre-built app that loads your JavaScript. It contains a fixed set
of native modules, and this project needs several that are not in it:

- `@op-engineering/op-sqlite`, compiled against **SQLCipher** — the encrypted
  local database
- `expo-secure-store` — the Keychain/Keystore the data key lives in
- `expo-local-authentication` — Face ID / fingerprint / device passcode unlock
- `expo-web-browser` and `expo-auth-session` — the OAuth flow

Native code cannot be added to Expo Go from JavaScript. So every path below
builds a real app. In practice this means one slow first build, then normal fast
reloads.

**`ios/` and `android/` are not in the repository.** They are generated:

```bash
npx expo prebuild
```

That is a required step after cloning, not an optional one. Re-run it with
`--clean` after changing `app.json`.

---

## Prerequisites

**Everyone:** [Node.js](https://nodejs.org) 20 or newer, and Git.

```bash
npm install
```

**iOS/iPadOS** — a Mac. Nothing else builds for Apple platforms.

- Xcode from the Mac App Store, then open it once to accept the licence and let
  it install components.
- CocoaPods: `sudo gem install cocoapods`, or `brew install cocoapods`.
- For a physical device: connect it over USB, trust the Mac, and enable
  Developer Mode (Settings → Privacy & Security → Developer Mode).

**Android** — Mac, Windows or Linux.

- [Android Studio](https://developer.android.com/studio). During setup install
  the SDK, the SDK Platform-Tools, and an emulator image if you want one.
- A **JDK 17**. Android Studio bundles one; if `java -version` shows 1.8 you have
  an old system Java that Gradle will refuse. Point `JAVA_HOME` at the bundled
  JDK rather than replacing your system one.
- Set `ANDROID_HOME`, e.g. on macOS:

  ```bash
  export ANDROID_HOME=$HOME/Library/Android/sdk
  ```

- For a physical device: enable Developer Options and USB debugging, connect,
  and accept the prompt. Check with `adb devices`.

---

## Development builds

Compiles the app, installs it on a simulator/emulator or a connected device, and
attaches the dev server so edits reload.

```bash
npm run ios
```

```bash
npm run android
```

First run takes several minutes — it is compiling SQLCipher and every other
native dependency. After that:

```bash
npm start
```

starts just the dev server against the already-installed app.

### Android cannot reach `127.0.0.1`

This one bites everybody. Inside the emulator, `127.0.0.1` is the *emulator's*
own loopback, not your machine's — so a `.env` pointing at `127.0.0.1:8000`
works on the iOS simulator and silently fails on Android.

The fix is to forward the ports, not to edit `.env`:

```bash
adb reverse tcp:8000 tcp:8000 && adb reverse tcp:8080 tcp:8080
```

Re-run after every emulator restart. On a **physical** Android device use your
machine's LAN IP in `.env` instead, and make sure your firewall allows it.

### SQLCipher is a compile-time switch

`package.json` carries:

```json
"op-sqlite": { "sqlcipher": true }
```

This is read by the native build, not at runtime. Changing it requires a full
rebuild — a Metro reload will not pick it up. Without it the encryption key is
accepted and silently ignored, and every note is stored in the clear. The app
asserts this at startup so the mistake fails loudly rather than quietly.

### If CocoaPods dies with an encoding error

```
Unicode Normalization not appropriate for ASCII-8BIT
```

is not a Ruby bug — it means your shell has no `LANG` set. Fix:

```bash
export LANG=en_US.UTF-8
```

---

## Distributable builds

An app you install and keep, with the JavaScript bundled in, that runs with no
dev server and no computer attached.

### Android

The straightforward one. There is no signing expiry and no paid account.

```bash
npx eas build --platform android --profile preview
```

That builds an APK on Expo's servers and gives you a download link — free tier,
queued. Requires a free Expo account (`npx eas login`).

To build locally instead, add `--local` (needs the full Android toolchain on
your machine), or use Gradle directly after a prebuild:

```bash
cd android && ./gradlew assembleRelease
```

Install with `adb install <path-to-apk>`, or just download it on the phone.

### iOS and iPadOS

Apple requires every app to be signed, and the terms differ sharply by account.

**Free (personal team).** Sign in to Xcode with any Apple ID, no payment. You
can build to your own devices, with two real limits:

- **Signatures expire after 7 days.** The app stops launching and must be
  re-installed over USB, roughly weekly, forever.
- No over-the-air updates and no TestFlight.

**Paid ([Apple Developer Program](https://developer.apple.com/programs/),
$99/year).**

- Signatures last a year.
- EAS over-the-air updates work — push a JavaScript change without rebuilding.
  A free team cannot use these at all.
- TestFlight, and the App Store.

If you are building this for yourself, the free team works; you will just
re-install weekly. If re-installing weekly sounds intolerable, that is what the
$99 buys.

To build and install on a connected device:

```bash
npx expo run:ios --configuration Release --device
```

Release rather than Debug matters: a Debug build fetches its JavaScript from
your Mac at launch, so it only runs while that Mac is reachable. Release bundles
the JavaScript in, which is the point of putting it on a device you carry.

### A warning about `npm run ios:live`

That script exists in `package.json` and it is **not for you**. It builds
against the maintainer's own hosted backend, whose addresses are hardcoded in
`eas.json` under the `live` profile. Running it would build an app pointing at
someone else's server. Use `npx expo run:ios` and your own `.env`.

The same applies to `eas.json`'s `live` profile for Android.

---

## Web

```bash
npm run web
```

**This is unverified.** The configuration exists (`app.json` has
`web.output: "single"`, and there is a web build of the editor), but it has not
been run to a working state. PowerSync's web client needs a different SQLite
backend — WebAssembly rather than the native module — and that swap has not been
made. Treat it as a starting point, not a feature. See
[roadmap.md](roadmap.md).

---

## Command reference

Everything in `package.json`:

| Command | What it does |
|---|---|
| `npm start` | Dev server only; app must already be installed |
| `npm run ios` | Build, install, and run on iOS simulator or device |
| `npm run android` | Build, install, and run on Android emulator or device |
| `npm run web` | Web dev server (unverified) |
| `npm run lint` | ESLint |
| `npm run ios:live` | **Maintainer only** — builds against the maintainer's backend |

Plus, not in `package.json`:

| Command | What it does |
|---|---|
| `npx expo prebuild --clean` | Regenerate `ios/` and `android/` after an `app.json` change |
| `npx tsc --noEmit` | Type-check |
| `npx expo-doctor` | Check for dependency and config problems |
