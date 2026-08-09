#!/usr/bin/env bash
#
# Build the iOS app against the LIVE stack (Supabase Cloud + PowerSync Cloud)
# and install it on a connected device.
#
# You will run this roughly weekly. The Apple Developer account is a free
# personal team, so the signature expires after 7 days and the app stops
# launching until it is re-signed -- which is all this script does on a repeat
# run.
#
# The dev stack stays the default everywhere else: plain `npm run ios` and
# `npm start` read .env and talk to 127.0.0.1, exactly as before.
#
# Usage: npm run ios:live              # auto-detects a single connected device
#        npm run ios:live -- <udid>    # or name one explicitly

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# CocoaPods calls String#unicode_normalize on the project path, which raises
# `Unicode Normalization not appropriate for ASCII-8BIT` unless the locale says
# UTF-8. Inherited environments (a non-login shell, a CI runner, an agent) often
# have no LANG at all, and the failure reads like a Ruby bug rather than a
# missing environment variable.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# The live values are read out of eas.json rather than duplicated here. The
# Android APK gets them from that same `live` profile, and two hand-maintained
# copies of a server address is exactly how an iPad and a phone end up quietly
# syncing against different backends.
#
# Deliberately not a .env.production file: Expo's docs warn against switching
# environments on NODE_ENV, because `expo export` forces NODE_ENV=production
# regardless of intent. Variables already exported into the process beat .env
# under standard dotenv resolution, so Xcode's bundling phase inlines these
# while .env still supplies everything else.
eval "$(node -e '
  const profile = require("./eas.json").build.live;
  if (!profile || !profile.env) {
    console.error("no live profile env in eas.json");
    process.exit(1);
  }
  for (const [k, v] of Object.entries(profile.env)) {
    console.log(`export ${k}=${JSON.stringify(v)}`);
  }
')"

UDID="${1:-}"
if [[ -z "$UDID" ]]; then
  UDID=$(xcrun devicectl list devices --json-output - 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      const devices = JSON.parse(s).result.devices.filter(
        d => d.connectionProperties?.tunnelState === "connected" &&
             d.hardwareProperties?.platform === "iOS"
      );
      if (devices.length !== 1) {
        console.error(`expected exactly 1 connected iOS device, found ${devices.length}`);
        process.exit(1);
      }
      console.log(devices[0].hardwareProperties.udid);
    });
  ')
fi

echo "Device     $UDID"
echo "Supabase   $EXPO_PUBLIC_SUPABASE_URL"
echo "PowerSync  $EXPO_PUBLIC_POWERSYNC_URL"
echo

# xcodebuild directly, not `expo run:ios`. Expo's CLI cannot parse the
# devicectl output from Xcode 26.6 -- it warns "Unexpected devicectl JSON
# version output" and then fails every device lookup with "No device UDID or
# name matching ...", even for a device `xcrun devicectl` lists happily. Going
# straight to xcodebuild skips that code path entirely and avoids bumping Expo
# on an otherwise working project.
#
# Release, not Debug: a Debug build fetches its JS from Metro at launch, so it
# only runs while this Mac is reachable. Release bundles the JS into the app,
# which is the entire point of putting it on a device you carry around. It also
# means no dev server, so nothing competes for port 8081 with another checkout.
if [[ ! -d ios ]]; then
  npx expo prebuild --platform ios
fi

xcodebuild \
  -workspace ios/notes.xcworkspace \
  -scheme notes \
  -configuration Release \
  -destination "id=$UDID" \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  build

APP="ios/build/Build/Products/Release-iphoneos/notes.app"
[[ -d "$APP" ]] || { echo "error: no app bundle at $APP" >&2; exit 1; }

xcrun devicectl device install app --device "$UDID" "$APP"
